const messages = new Map([
  ['invalid', '激活码无效或已停用，请核对后重试。'],
  ['limited', '尝试次数过多，请稍后再试。']
]);
export const login = (reason) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>激活成绩条工作台</title><link rel="stylesheet" href="/style.css"></head>
<body><header class="bar"><div class="brand">成绩条工作台</div></header><main>
<section class="controls" style="max-width:440px;margin:24px auto">
<h1>激活工作台</h1><p>输入购买后收到的激活码，即可进入成绩条工具。</p>
<form method="post" action="/activate" class="activation-form">
<label for="code">激活码</label>
<input id="code" name="code" type="text" required maxlength="40" spellcheck="false" autocapitalize="characters" autocomplete="off">
<button type="submit">激活并进入</button>
</form>
${messages.has(reason) ? `<p role="alert" class="activation-error">${messages.get(reason)}</p>` : ''}
<p class="hint">当前浏览器会保留激活状态。换浏览器时可以用原码重新激活。</p>
</section></main></body></html>`;
