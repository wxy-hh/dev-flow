import { parseEvidenceObjectRef, type EvidenceObjectRef } from "./evidence-store.js";

/**
 * Phase 4 plan-revision proposal contract. The proposal is frozen and
 * content-addressed before user confirmation; confirm only validates basis and
 * atomically applies the exact compiled Trace/UNIT projection it contains.
 */

export interface ImplementationRuntimeProjection {
  units: Array<{
    unitId: string;
    tasks: string[];
    dependsOn: string[];
    fileScope: string[];
    forwardVerification: string[];
  }>;
  recoveryArrangements: Array<{
    arrangementId: string;
    stepRef: string;
    recoveryKind: "rollback" | "compensation";
    method: string;
    riskRef: string;
  }>;
}

export interface PlanRevisionProposal {
  schemaVersion: 1;
  featureId: string;
  artifact: { path: string; rawSha256: string; semanticSha256: string };
  basis: {
    stateRevision: number;
    currentTraceSha256: string;
    requirementsArtifactSha256: string;
    requirementsSemanticSha256: string;
    requirementsSliceSha256: string;
    projectConfigSha256: string;
    executionSemanticBasisHash?: string;
  };
  compiledTrace: EvidenceObjectRef;
  implementationProjection: ImplementationRuntimeProjection;
  impact: {
    affectedUnits: string[];
    redoUnits: string[];
    sideEffectUnits: string[];
    invalidatedPhases: Array<"plan" | "code">;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function stringArray(value: unknown, allowEmpty = false): value is string[] {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every((item) => typeof item === "string" && item.length > 0);
}

export function parseImplementationRuntimeProjection(value: unknown): ImplementationRuntimeProjection {
  if (!isRecord(value) || !Array.isArray(value.units) || !Array.isArray(value.recoveryArrangements)) {
    throw new TypeError("invalid implementation runtime projection");
  }
  const units = value.units.map((unit) => {
    if (!isRecord(unit) || typeof unit.unitId !== "string" || !/^UNIT-[0-9]{3,}$/.test(unit.unitId)
      || !stringArray(unit.tasks) || !stringArray(unit.dependsOn, true)
      || !stringArray(unit.fileScope) || !stringArray(unit.forwardVerification)) {
      throw new TypeError("invalid implementation runtime projection unit");
    }
    return {
      unitId: unit.unitId,
      tasks: unit.tasks as string[],
      dependsOn: unit.dependsOn as string[],
      fileScope: unit.fileScope as string[],
      forwardVerification: unit.forwardVerification as string[],
    };
  });
  const recoveryArrangements = value.recoveryArrangements.map((recovery) => {
    if (!isRecord(recovery) || typeof recovery.arrangementId !== "string"
      || typeof recovery.stepRef !== "string" || !/^(?:UNIT|TASK)-[0-9]{3,}$/.test(recovery.stepRef)
      || (recovery.recoveryKind !== "rollback" && recovery.recoveryKind !== "compensation")
      || typeof recovery.method !== "string" || !recovery.method.trim()
      || typeof recovery.riskRef !== "string" || !recovery.riskRef.trim()) {
      throw new TypeError("invalid implementation runtime projection recovery");
    }
    return {
      arrangementId: recovery.arrangementId,
      stepRef: recovery.stepRef,
      recoveryKind: recovery.recoveryKind as "rollback" | "compensation",
      method: recovery.method,
      riskRef: recovery.riskRef,
    };
  });
  return { units, recoveryArrangements };
}

export function parsePlanRevisionProposal(value: unknown): PlanRevisionProposal {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.featureId !== "string" || !value.featureId
    || !isRecord(value.artifact) || typeof value.artifact.path !== "string" || !value.artifact.path
    || !isSha256(value.artifact.rawSha256) || !isSha256(value.artifact.semanticSha256)
    || !isRecord(value.basis) || !Number.isInteger(value.basis.stateRevision)
    || !isSha256(value.basis.currentTraceSha256)
    || !isSha256(value.basis.requirementsArtifactSha256)
    || !isSha256(value.basis.requirementsSemanticSha256)
    || !isSha256(value.basis.requirementsSliceSha256)
    || !isSha256(value.basis.projectConfigSha256)
    || (value.basis.executionSemanticBasisHash !== undefined && !isSha256(value.basis.executionSemanticBasisHash))
    || !isRecord(value.compiledTrace)
    || !isSha256(value.compiledTrace.sha256) || !Number.isInteger(value.compiledTrace.size)
    || !isRecord(value.impact)
    || !Array.isArray(value.impact.affectedUnits) || !Array.isArray(value.impact.redoUnits)
    || !Array.isArray(value.impact.sideEffectUnits)
    || !Array.isArray(value.impact.invalidatedPhases)) {
    throw new TypeError("invalid plan revision proposal");
  }
  return {
    schemaVersion: 1,
    featureId: value.featureId,
    artifact: {
      path: value.artifact.path,
      rawSha256: value.artifact.rawSha256,
      semanticSha256: value.artifact.semanticSha256,
    },
    basis: {
      stateRevision: value.basis.stateRevision as number,
      currentTraceSha256: value.basis.currentTraceSha256,
      requirementsArtifactSha256: value.basis.requirementsArtifactSha256,
      requirementsSemanticSha256: value.basis.requirementsSemanticSha256,
      requirementsSliceSha256: value.basis.requirementsSliceSha256,
      projectConfigSha256: value.basis.projectConfigSha256,
      ...(value.basis.executionSemanticBasisHash !== undefined
        ? { executionSemanticBasisHash: value.basis.executionSemanticBasisHash }
        : {}),
    },
    compiledTrace: parseEvidenceObjectRef(value.compiledTrace),
    implementationProjection: parseImplementationRuntimeProjection(value.implementationProjection),
    impact: {
      affectedUnits: value.impact.affectedUnits as string[],
      redoUnits: value.impact.redoUnits as string[],
      sideEffectUnits: value.impact.sideEffectUnits as string[],
      invalidatedPhases: value.impact.invalidatedPhases as Array<"plan" | "code">,
    },
  };
}
