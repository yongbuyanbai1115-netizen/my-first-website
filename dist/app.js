import { readWorkbook } from "./xlsx.js";

const subjects = ["语文","数学","英语","物理","化学","生物","政治","历史","地理","科学","道德与法治","劳动","信息科技","体育","音乐","美术"];
const get = (id) => document.getElementById(id);
const normalize = (value) => value.normalize("NFKC").replace(/\s/g, "");
let workbook;
let request = 0;

function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}

function setup(rows) {
  const headers = rows.find((row) => row.number === 1)?.cells ?? new Map();
  const columns = [...headers].filter(([, cell]) => cell.value && !cell.invalid)
    .map(([key, cell]) => ({ key, label: cell.value }));
  if (!columns.length) throw Error("第 1 行没有可读取的表头。");
  const unique = (labels) => {
    for (const label of labels) {
      const matches = columns.filter((column) => normalize(column.label) === label);
      if (matches.length) return matches.length === 1 ? matches[0].key : "";
    }
    return "";
  };
  const fields = columns.map((column) => ({
    ...column,
    title: column.label,
    enabled: /^(总分|总成绩|合计分)$/.test(normalize(column.label)) ||
      subjects.includes(normalize(column.label).replace(/(?:成绩|分数|得分)$/, ""))
  }));
  return {
    rows: rows.filter((row) => row.number > 1 && [...row.cells.values()].some((cell) => cell.value || cell.invalid)),
    columns, fields, name: unique(["姓名","学生姓名","考生姓名"]), id: unique(["学号","学生学号","考号"])
  };
}

function readRecords({ rows, name, id, fields }) {
  if (!name) throw Error("请选择姓名对应的列。");
  if (id && name === id) throw Error("姓名和学号需要选择不同的列。");
  const selected = fields.filter((field) => field.enabled && field.key !== name && field.key !== id);
  if (!selected.length) throw Error("请至少勾选一个要显示的成绩字段。");
  if (!rows.length) throw Error("表头下没有学生记录。");
  const errors = [];
  const records = rows.map((row) => {
    const student = row.cells.get(name);
    const number = row.cells.get(id);
    if (!student?.value || student.invalid) errors.push(`第 ${row.number} 行「姓名」为空或无法读取。`);
    if (number?.invalid) errors.push(`第 ${row.number} 行「学号」无法读取。`);
    const values = selected.map((field) => {
      const cell = row.cells.get(field.key);
      if (cell?.invalid || (cell?.value && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(cell.value))) {
        errors.push(`第 ${row.number} 行「${field.label}」应为数字或留空。`);
      }
      return cell?.value ?? "";
    });
    return { name: student?.value ?? "", id: number?.display ?? "", values };
  });
  if (errors.length) throw Error(errors.slice(0, 8).join("\n") + (errors.length > 8 ? `\n共 ${errors.length} 处问题。` : ""));
  return { visibleScores: selected.map((field) => field.title.trim() || field.label), records };
}

function renderMapping() {
  const panel = get("mapping-fields");
  const fragment = document.createDocumentFragment();
  for (const [key, label, placeholder] of [["name", "姓名列", "请选择"], ["id", "学号列", "不显示"]]) {
    const wrapper = element("label", label, "mapping-select");
    const select = element("select");
    select.append(new Option(placeholder, ""));
    for (const col of workbook.columns) select.append(new Option(`${col.key} · ${col.label}`, col.key));
    select.value = workbook[key];
    select.addEventListener("change", () => {
      workbook[key] = select.value;
      renderMapping();
      updatePreview();
      panel.querySelectorAll("select")[key === "name" ? 0 : 1].focus();
    });
    wrapper.append(select);
    fragment.append(wrapper);
  }
  const fields = workbook.fields.filter((field) => field.key !== workbook.name && field.key !== workbook.id);
  for (const [index, field] of fields.entries()) {
    const row = element("div", undefined, "mapping-row");
    const label = element("label", undefined, "mapping-checkbox");
    const checkbox = element("input");
    checkbox.type = "checkbox";
    checkbox.checked = field.enabled;
    checkbox.addEventListener("change", () => { field.enabled = checkbox.checked; updatePreview(); });
    label.append(checkbox, element("span", `${field.key} · ${field.label}`));
    const title = element("input");
    title.value = field.title;
    title.maxLength = 40;
    title.setAttribute("aria-label", `${field.label}的显示名称`);
    title.addEventListener("input", () => { field.title = title.value; updatePreview(); });
    row.append(label, title);
    for (const [offset, name] of [[-1, "上移"], [1, "下移"]]) {
      const button = element("button", name, "secondary");
      button.type = "button";
      button.disabled = !fields[index + offset];
      button.setAttribute("aria-label", name + field.label);
      button.addEventListener("click", () => {
        const a = workbook.fields.indexOf(field);
        const b = workbook.fields.indexOf(fields[index + offset]);
        [workbook.fields[a], workbook.fields[b]] = [workbook.fields[b], workbook.fields[a]];
        renderMapping();
        updatePreview();
        const controls = panel.querySelectorAll(".mapping-row");
        (controls[index + offset].querySelectorAll("button")[offset === -1 ? 0 : 1].disabled
          ? controls[index + offset].querySelector("input")
          : controls[index + offset].querySelectorAll("button")[offset === -1 ? 0 : 1]).focus();
      });
      row.append(button);
    }
    fragment.append(row);
  }
  panel.replaceChildren(fragment);
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

function showError(error, status) {
  get("slips").replaceChildren();
  get("print").disabled = true;
  get("status").textContent = status;
  get("error").textContent = error instanceof RangeError ? "文件已损坏，请重新保存为 .xlsx。" : error.message;
  get("error").hidden = false;
}

function updatePreview() {
  get("error").hidden = true;
  try {
    render(readRecords(workbook));
  } catch (error) {
    get("mapping").open = true;
    showError(error, "请检查成绩字段");
  }
}

async function load(read, isExample = false) {
  const ticket = ++request;
  get("slips").replaceChildren();
  get("mapping").hidden = true;
  get("empty").hidden = true;
  get("error").hidden = true;
  get("print").disabled = true;
  get("status").textContent = "正在读取成绩表…";
  try {
    const rows = await readWorkbook(await read());
    if (ticket !== request) return;
    workbook = setup(rows);
    renderMapping();
    get("mapping").hidden = false;
    get("mapping").open = !isExample;
    updatePreview();
  } catch (error) {
    if (ticket === request) showError(error, "导入失败");
  }
}

get("file").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (!file) return;
  event.target.value = "";
  load(() => {
    if (!/\.xlsx$/i.test(file.name)) throw Error("请选择 .xlsx 文件。");
    if (file.size > 15 * 1024 * 1024) throw Error("请使用不超过 15 MB 的成绩表。");
    return file.arrayBuffer();
  });
});
get("example").addEventListener("click", () => load(async () => {
  const response = await fetch("template.xlsx");
  if (!response.ok) throw Error("暂时无法读取示例文件。");
  return response.arrayBuffer();
}, true));
get("heading").addEventListener("input", () => {
  for (const heading of get("slips").querySelectorAll("h3")) heading.textContent = get("heading").value.trim() || "班级考试成绩单";
});
get("print").addEventListener("click", () => window.print());
