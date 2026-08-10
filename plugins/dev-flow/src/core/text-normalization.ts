/**
 * 回答文本的单一归一化规则：折叠空白、小写、剥除标点与括号。
 * 事件匹配与选项匹配共用同一规则，避免两处比较语义不一致。
 */
export function normalizeReplyText(value: string): string {
  return value
    .trim()
    .replace(/[\s\u00A0\uFEFF]+/g, " ")
    .replace(/[，。！？、；：,.!?;:()（）【】\[\]“”"']/g, "")
    .toLowerCase();
}

/**
 * 语义兼容：归一化后相等，或一方是另一方的前缀。
 * 只容忍尾部差异（展示后缀、标点漂移、精简转述），
 * 前缀否定（「不/未/别/勿」）永不兼容，防止拒绝被误判为确认。
 */
export function textCompatible(left: string, right: string): boolean {
  const a = normalizeReplyText(left);
  const b = normalizeReplyText(right);
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}
