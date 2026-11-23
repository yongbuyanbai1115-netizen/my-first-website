const decoder = new TextDecoder();
const tags = (node, name) => Array.from(node.getElementsByTagNameNS("*", name));
const xml = (bytes) => {
  const doc = new DOMParser().parseFromString(decoder.decode(bytes), "application/xml");
  if (doc.querySelector("parsererror")) throw Error("Excel 文件内部格式有误。");
  return doc;
};
function zipEntries(buffer) {
  const view = new DataView(buffer);
  const u16 = (offset) => view.getUint16(offset, true);
  const u32 = (offset) => view.getUint32(offset, true);
  let end = buffer.byteLength - 22;
  while (end >= Math.max(0, buffer.byteLength - 65557)) {
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === buffer.byteLength) break;
    end--;
  }
  if (end < Math.max(0, buffer.byteLength - 65557)) throw Error("无法打开文件，请重新保存为 .xlsx 后重试。");
  const entries = new Map();
  let cursor = u32(end + 16);
  for (let i = 0; i < u16(end + 10); i++) {
    if (u32(cursor) !== 0x02014b50) throw Error("Excel 文件目录有误。");
    const nameLength = u16(cursor + 28);
    const name = decoder.decode(new Uint8Array(buffer, cursor + 46, nameLength));
    entries.set(name, { method: u16(cursor + 10), size: u32(cursor + 20), expanded: u32(cursor + 24), local: u32(cursor + 42) });
    cursor += 46 + nameLength + u16(cursor + 30) + u16(cursor + 32);
  }
  return async (name) => {
    const entry = entries.get(name);
    if (!entry) return null;
    const { method, size, expanded, local } = entry;
    if (expanded > 24 * 1024 * 1024 || u32(local) !== 0x04034b50) throw Error("工作表过大或文件已损坏。");
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    const bytes = new Uint8Array(buffer, start, size);
    if (method === 0) return xml(bytes);
    if (method !== 8) throw Error("请先用 Excel 将文件另存为普通 .xlsx。");
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const chunks = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > expanded) {
        await reader.cancel();
        throw Error("工作表解压后大小有误。");
      }
      chunks.push(value);
    }
    return xml(await new Blob(chunks).arrayBuffer());
  };
}
const textRuns = (node) => tags(node, "t").filter((item) => item.parentElement.localName !== "rPh").map((item) => item.textContent).join("");
export async function readWorkbook(buffer) {
  const read = zipEntries(buffer);
  const book = await read("xl/workbook.xml");
  const relationships = await read("xl/_rels/workbook.xml.rels");
  if (!book || !relationships) throw Error("找不到 Excel 工作簿。");
  const sheets = tags(book, "sheet");
  const selected = sheets.find((sheet) => sheet.getAttribute("name") === "成绩") ??
    sheets.find((sheet) => sheet.getAttribute("state") !== "hidden" && !/说明/.test(sheet.getAttribute("name")));
  if (!selected) throw Error("找不到成绩工作表。");
  const id = Array.from(selected.attributes).find((attr) => attr.localName === "id")?.value;
  const relation = tags(relationships, "Relationship").find((item) => item.getAttribute("Id") === id);
  const target = relation?.getAttribute("Target");
  if (!target || relation.getAttribute("TargetMode") === "External") throw Error("无法读取成绩工作表。");
  const path = new URL(target, "https://workbook.invalid/xl/workbook.xml").pathname.slice(1);
  const [sheet, strings, styles] = await Promise.all([read(path), read("xl/sharedStrings.xml"), read("xl/styles.xml")]);
  if (!sheet) throw Error("无法读取成绩工作表。");
  const dictionary = strings ? tags(strings, "si").map(textRuns) : [];
  const cellFormats = styles ? Array.from(tags(styles, "cellXfs")[0]?.children ?? []) : [];
  const formats = new Map((styles ? tags(styles, "numFmt") : []).map((item) => [item.getAttribute("numFmtId"), item.getAttribute("formatCode")]));
  return tags(sheet, "row").map((row) => ({
    number: Number(row.getAttribute("r")),
    cells: new Map(tags(row, "c").map((cell) => {
      const address = cell.getAttribute("r");
      const raw = tags(cell, "v")[0]?.textContent ?? "";
      const type = cell.getAttribute("t");
      const value = type === "s" ? dictionary[Number(raw)] ?? "" : type === "inlineStr" ? textRuns(cell) : raw;
      const format = formats.get(cellFormats[Number(cell.getAttribute("s"))]?.getAttribute("numFmtId"));
      return [address.replace(/\d+$/, ""), {
        value: value.trim(),
        invalid: type === "e" || type === "b" || (!raw && tags(cell, "f").length > 0),
        display: /^0{2,}$/.test(format ?? "") && /^\d+$/.test(value) ? value.padStart(format.length, "0") : value.trim()
      }];
    }))
  }));
}
