import type { SessionResult, SerializedObservation } from '../history/types.js';
import type { Rule } from '../parsers/types.js';
import type { ObservationConfidence, VerificationMethod } from '../verifiers/types.js';

export interface RuleAdherence {
  rule: Rule;
  relevantCount: number;
  resolvedCount: number;
  inconclusiveCount: number;
  totalSessions: number;
  followedCount: number;
  adherence: number | null;
  confidence: ObservationConfidence;
  confidenceReason: string;
  method: VerificationMethod;
  evidence?: string;
}

const CONFIDENCE_RANK: Record<ObservationConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const METHOD_RANK: Record<VerificationMethod, number> = {
  'auto:bash-keyword': 5,
  'auto:file-pattern': 5,
  'auto:bash-sequence': 4,
  'auto:heuristic-structure': 4,
  'user:custom': 3,
  'llm-judge': 3,
  'scope:filtered': 2,
  unmapped: 1,
};

function truncateEvidence(text: string | undefined, maxLength = 160): string | undefined {
  if (!text) return undefined;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function strongestObservation(
  observations: SerializedObservation[],
): SerializedObservation | undefined {
  return observations
    .slice()
    .sort((a, b) => {
      const confidenceDelta = (CONFIDENCE_RANK[b.confidence as ObservationConfidence] ?? 0)
        - (CONFIDENCE_RANK[a.confidence as ObservationConfidence] ?? 0);
      if (confidenceDelta !== 0) return confidenceDelta;

      return (METHOD_RANK[b.method as VerificationMethod] ?? 0)
        - (METHOD_RANK[a.method as VerificationMethod] ?? 0);
    })[0];
}

function dominantMethod(
  observations: SerializedObservation[],
): VerificationMethod {
  const counts = new Map<VerificationMethod, number>();

  for (const observation of observations) {
    const method = observation.method as VerificationMethod;
    counts.set(method, (counts.get(method) ?? 0) + 1);
  }

  let bestMethod: VerificationMethod = 'unmapped';
  let bestCount = 0;

  for (const [method, count] of counts) {
    if (
      count > bestCount ||
      (count === bestCount && (METHOD_RANK[method] ?? 0) > (METHOD_RANK[bestMethod] ?? 0))
    ) {
      bestMethod = method;
      bestCount = count;
    }
  }

  return bestMethod;
}

function buildEvidence(
  relevantResolved: SerializedObservation[],
  relevantInconclusive: SerializedObservation[],
  irrelevant: SerializedObservation[],
  method: VerificationMethod,
  followedCount: number,
  resolvedCount: number,
): string | undefined {
  const resolvedForMethod = relevantResolved.filter((obs) => obs.method === method);
  const followed = strongestObservation(resolvedForMethod.filter((obs) => obs.followed === true));
  const notFollowed = strongestObservation(resolvedForMethod.filter((obs) => obs.followed === false));

  if (followed && notFollowed) {
    const followedEvidence = truncateEvidence(followed.evidence);
    const notFollowedEvidence = truncateEvidence(notFollowed.evidence);
    if (followedEvidence && notFollowedEvidence) {
      return truncateEvidence(
        `Mixed results across ${resolvedCount} resolved sessions (${followedCount} followed). Example followed: ${followedEvidence} Counterexample: ${notFollowedEvidence}`,
      );
    }
  }

  const candidate = strongestObservation(
    resolvedForMethod.length > 0
      ? resolvedForMethod
      : relevantInconclusive.length > 0
        ? relevantInconclusive
        : irrelevant,
  );

  return truncateEvidence(candidate?.evidence);
}

function calibrateConfidence(params: {
  totalSessions: number;
  relevantCount: number;
  resolvedCount: number;
  inconclusiveCount: number;
  followedCount: number;
  method: VerificationMethod;
  resolvedMethods: VerificationMethod[];
}): { confidence: ObservationConfidence; reason: string } {
  const {
    totalSessions,
    relevantCount,
    resolvedCount,
    inconclusiveCount,
    followedCount,
    method,
    resolvedMethods,
  } = params;

  if (totalSessions === 0) {
    return {
      confidence: 'low',
      reason: 'No sessions have been analyzed yet.',
    };
  }

  if (relevantCount === 0) {
    if (method === 'scope:filtered') {
      const confidence: ObservationConfidence =
        totalSessions >= 5 ? 'high' : totalSessions >= 2 ? 'medium' : 'low';
      return {
        confidence,
        reason: `Rule was out of scope in all ${totalSessions} analyzed sessions.`,
      };
    }

    return {
      confidence: 'low',
      reason: 'No relevant sessions were found for this rule.',
    };
  }

  if (resolvedCount === 0) {
    return {
      confidence: 'low',
      reason: inconclusiveCount > 0
        ? `Found ${inconclusiveCount} relevant session${inconclusiveCount === 1 ? '' : 's'}, but none produced conclusive evidence.`
        : 'No conclusive evidence was available for relevant sessions.',
    };
  }

  let score =
    method === 'auto:bash-keyword' || method === 'auto:file-pattern'
      ? 3
      : method === 'auto:bash-sequence' || method === 'auto:heuristic-structure' || method === 'llm-judge' || method === 'user:custom'
        ? 2
        : 1;

  if (resolvedCount >= 5) {
    score += 1;
  } else if (resolvedCount === 1) {
    score -= 2;
  } else if (resolvedCount === 2) {
    score -= 1;
  }

  const uniqueMethods = new Set(resolvedMethods).size;
  if (uniqueMethods > 1) {
    score -= 1;
  }

  if (inconclusiveCount > resolvedCount) {
    score -= 2;
  } else if (inconclusiveCount > 0) {
    score -= 1;
  }

  const consistentOutcome = followedCount === 0 || followedCount === resolvedCount;
  if (consistentOutcome) {
    score += 1;
  } else {
    score -= 1;
  }

  const bounded = Math.max(1, Math.min(3, score));
  const confidence: ObservationConfidence =
    bounded >= 3 ? 'high' : bounded === 2 ? 'medium' : 'low';

  const reasonParts = [
    `${resolvedCount} resolved session${resolvedCount === 1 ? '' : 's'}`,
    `dominant method: ${method}`,
  ];

  if (inconclusiveCount > 0) {
    reasonParts.push(`${inconclusiveCount} inconclusive`);
  }
  if (uniqueMethods > 1) {
    reasonParts.push('mixed evidence sources');
  }
  reasonParts.push(consistentOutcome ? 'consistent outcomes' : 'mixed outcomes');

  return {
    confidence,
    reason: `${reasonParts.join('; ')}.`,
  };
}

export function aggregateAdherence(
  rules: Rule[],
  allResults: SessionResult[],
): RuleAdherence[] {
  return rules.map((rule) => {
    const observations = allResults
      .flatMap((result) => result.observations)
      .filter((observation) => observation.ruleId === rule.id);

    const relevant = observations.filter((observation) => observation.relevant);
    const relevantResolved = relevant.filter((observation) => observation.followed !== null);
    const relevantInconclusive = relevant.filter((observation) => observation.followed === null);
    const irrelevant = observations.filter((observation) => !observation.relevant);

    const relevantCount = relevant.length;
    const resolvedCount = relevantResolved.length;
    const inconclusiveCount = relevantInconclusive.length;
    const followedCount = relevantResolved.filter((observation) => observation.followed === true).length;

    const method = resolvedCount > 0
      ? dominantMethod(relevantResolved)
      : relevantCount > 0
        ? dominantMethod(relevant)
        : dominantMethod(irrelevant);

    const { confidence, reason } = calibrateConfidence({
      totalSessions: allResults.length,
      relevantCount,
      resolvedCount,
      inconclusiveCount,
      followedCount,
      method,
      resolvedMethods: relevantResolved.map((observation) => observation.method as VerificationMethod),
    });

    return {
      rule,
      relevantCount,
      resolvedCount,
      inconclusiveCount,
      totalSessions: allResults.length,
      followedCount,
      adherence: resolvedCount > 0 ? followedCount / resolvedCount : null,
      confidence,
      confidenceReason: reason,
      method,
      evidence: buildEvidence(
        relevantResolved,
        relevantInconclusive,
        irrelevant,
        method,
        followedCount,
        resolvedCount,
      ),
    };
  });
}
