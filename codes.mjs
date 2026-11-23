import { createCodes, disableCode } from './activation-store.mjs';

const [action, argument] = process.argv.slice(2);
if (action === 'new' && /^\d+$/.test(argument ?? '') && Number(argument) >= 1 && Number(argument) <= 500) {
  console.log('activation_code,order_id,sent_at');
  for (const code of createCodes(Number(argument))) console.log(`${code},,`);
} else if (action === 'disable' && argument) {
  if (disableCode(argument)) console.log('已停用。此码已有的激活状态也会失效。');
  else {
    console.error('未找到可停用的激活码。');
    process.exitCode = 1;
  }
} else {
  console.error('用法：node codes.mjs new 10  或  node codes.mjs disable <激活码>');
  process.exitCode = 1;
}
