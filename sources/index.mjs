// 适配器登记处。加一个新 agent，只要在 sources/ 放一个模块，
// 导出 name / label / patterns / detect(file) / read(file)，再登记到下面。
import * as dsh from './dsh.mjs';
import * as codex from './codex.mjs';

export const adapters = [dsh, codex];

export const names = () => adapters.map((a) => a.name);

// 返回 { adapter, resolved } —— resolved 是实际用上的格式名
export function resolve(file, wanted = 'auto') {
  if (wanted && wanted !== 'auto') {
    const a = adapters.find((x) => x.name === wanted);
    if (!a) throw new Error(`未知格式: ${wanted}。支持: ${names().join(', ')}`);
    return { adapter: a, resolved: a.name };
  }
  for (const a of adapters) {
    if (a.detect(file)) return { adapter: a, resolved: a.name };
  }
  throw new Error(`认不出这是什么会话文件。支持: ${names().join(', ')}`);
}
