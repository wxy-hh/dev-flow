import { createHash } from "node:crypto";
import type { GovernanceRecordBase, RecordBasis, RecordBasisKind, RecordCurrency } from "../policy/types.js";

/**
 * 依据状态深模块（spec：内部"依据状态"）。
 *
 * 职责：创建依据、比较当前依据、派生记录当前性、计算受影响记录。
 * 约束：
 * - 当前性（current/stale/unconfirmed）只能通过本模块的纯函数派生，
 *   任何调用方都不能把结论写进记录；
 * - 不提供把一种治理记录转换成另一种记录的通用 evidence 接口。
 */

/** 当前依据快照：由 Core 在需要判定时提供。 */
export interface CurrentBasis {
  /** 当前工作区内容指纹（交付内容依据）。 */
  contentFingerprint?: string;
  /** 当前仍存在（未被清理）的宿主可信事件 id。 */
  eventIds?: ReadonlySet<string>;
  /** 语义切片当前哈希（如角色切片 / 命令切片）。 */
  sliceBases?: Readonly<Record<string, string>>;
}

export function createContentBasis(parts: string[]): RecordBasis {
  return { kind: "content", sha256: createHash("sha256").update(parts.join("\n")).digest("hex") };
}

export function createEventBasis(eventId: string): RecordBasis {
  return { kind: "event", eventId };
}

export function createSliceBasis(sliceKey: string, sliceHash: string): RecordBasis {
  return { kind: "slice", sliceKey, sliceHash };
}

function basisIsCurrent(basis: RecordBasis, current: CurrentBasis): boolean {
  switch (basis.kind) {
    case "content":
      return current.contentFingerprint !== undefined && basis.sha256 === current.contentFingerprint;
    case "event":
      return current.eventIds?.has(basis.eventId) ?? false;
    case "slice": {
      return current.sliceBases?.[basis.sliceKey] === basis.sliceHash;
    }
  }
}

/**
 * 派生一条治理记录的当前性。
 * - 没有依据（如 v4 迁移记录）：unconfirmed，不根据非空字段猜测有效；
 * - 依据存在但当前快照缺少对应信息：unconfirmed；
 * - 依据与当前快照匹配：current；不匹配：stale。
 */
export function deriveCurrency(record: Pick<GovernanceRecordBase, "basis">, current: CurrentBasis): RecordCurrency {
  const basis = record.basis;
  if (!basis) return "unconfirmed";
  if (!basisIsCurrent(basis, current)) return currentKnown(basis, current) ? "stale" : "unconfirmed";
  return "current";
}

function currentKnown(basis: RecordBasis, current: CurrentBasis): boolean {
  switch (basis.kind) {
    case "content": return current.contentFingerprint !== undefined;
    case "event": return basis.eventId !== undefined;
    case "slice": return current.sliceBases?.[basis.sliceKey] !== undefined;
  }
}

/**
 * 计算一条依据变化影响的记录 id 集合。
 * - 内容变化：保守影响所有 content 依据记录；
 * - 事件消费/清理：只影响引用该事件的记录；
 * - 切片变化：只影响该切片下的记录。
 */
export function affectedRecordIds(records: GovernanceRecordBase[], change: { kind: RecordBasisKind; eventId?: string; sliceKey?: string }): string[] {
  return records
    .filter((record) => {
      const basis = record.basis;
      if (!basis || basis.kind !== change.kind) return false;
      if (basis.kind === "event") return basis.eventId === change.eventId;
      if (basis.kind === "slice") return basis.sliceKey === change.sliceKey;
      return true;
    })
    .map((record) => record.recordId);
}
