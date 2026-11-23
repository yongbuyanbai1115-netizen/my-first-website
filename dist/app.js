import { readWorkbook } from "./xlsx.js";
const subjects = ["语文","数学","英语","物理","化学","生物","政治","历史","地理"];
const scores = [...subjects, "总分"];
const get = (id) => document.getElementById(id);
let current;
let request = 0;
function readRecords(rows) {
  const headers = rows.find((row) => row.number === 1)?.cells ?? new Map();
  const columns = new Map();
  for (const [column, cell] of headers) {
    if (![...scores, "学号", "姓名"].includes(cell.value)) continue;
    if (columns.has(cell.value)) throw Error(`第 1 行存在重复表头「${cell.value}」。`);
    columns.set(cell.value, column);
  }
  if (!columns.has("姓名")) throw Error("第 1 行缺少「姓名」表头。");
  const visibleScores = scores.filter((field) => columns.has(field));
  if (!visibleScores.some((field) => subjects.includes(field))) throw Error("第 1 行至少需要一个首版支持的科目表头，例如「语文」。");
  const records = [];
  const errors = [];
  for (const row of rows.filter((item) => item.number > 1)) {
    if (![...row.cells.values()].some((cell) => cell.value || cell.invalid)) continue;
    const lookup = (field) => row.cells.get(columns.get(field));
    const name = lookup("姓名");
    const id = lookup("学号");
    if (!name?.value || name.invalid) errors.push(`第 ${row.number} 行「姓名」为空或无法读取。`);
    if (id?.invalid) errors.push(`第 ${row.number} 行「学号」无法读取。`);
    const values = visibleScores.map((field) => {
      const cell = lookup(field);
      if (cell?.invalid || (cell?.value && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(cell.value))) {
        errors.push(`第 ${row.number} 行「${field}」应为数字或留空。`);
      }
      return cell?.value ?? "";
    });
    records.push({ name: name?.value ?? "", id: id?.display ?? "", values });
  }
  if (errors.length) throw Error(errors.slice(0, 8).join("\n") + (errors.length > 8 ? `\n共 ${errors.length} 处问题。` : ""));
  if (!records.length) throw Error("表头下没有学生记录。");
  return { visibleScores, records };
}
function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}
function render(data) {
  const fragment = document.createDocumentFragment();
  for (const student of data.records) {
    const slip = element("article", undefined, "slip");
    const identity = element("p", student.id ? `${student.name}　学号 ${student.id}` : student.name, "identity");
    const table = element("table");
    const header = table.createTHead().insertRow();
    for (const field of data.visibleScores) {
      const cell = element("th", field);
      cell.scope = "col";
      header.append(cell);
    }
    const values = table.createTBody().insertRow();
    for (const score of student.values) values.insertCell().textContent = score;
    const scroll = element("div", undefined, "score-scroll");
    scroll.append(table);
    slip.append(element("h3", get("heading").value.trim() || "班级考试成绩单"), identity, scroll);
    fragment.append(slip);
  }
  get("slips").replaceChildren(fragment);
  get("empty").hidden = true;
  get("print").disabled = false;
  get("status").textContent = `${data.records.length} 位学生 · A4 纵向`;
}
async function load(read) {
  const ticket = ++request;
  current = null;
  get("slips").replaceChildren();
  get("empty").hidden = true;
  get("error").hidden = true;
  get("print").disabled = true;
  get("status").textContent = "正在读取成绩表…";
  try {
    const rows = await readWorkbook(await read());
    if (ticket !== request) return;
    current = readRecords(rows);
    render(current);
  } catch (error) {
    if (ticket !== request) return;
    get("status").textContent = "导入失败";
    get("error").textContent = error instanceof RangeError ? "文件已损坏，请重新保存为 .xlsx。" : error.message;
    get("error").hidden = false;
  }
}
get("file").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (!file) return;
  event.target.value = "";
  load(() => {
    if (!/\.xlsx$/i.test(file.name)) throw Error("请选择 .xlsx 文件。");
    if (file.size > 15 * 1024 * 1024) throw Error("请使用小于 15 MB 的成绩表。");
    return file.arrayBuffer();
  });
});
get("example").addEventListener("click", () => load(async () => {
  const response = await fetch("template.xlsx");
  if (!response.ok) throw Error("暂时无法读取示例文件。");
  return response.arrayBuffer();
}));
get("heading").addEventListener("input", () => {
  for (const heading of get("slips").querySelectorAll("h3")) heading.textContent = get("heading").value.trim() || "班级考试成绩单";
});
get("print").addEventListener("click", () => window.print());
