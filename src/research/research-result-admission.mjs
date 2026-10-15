import {
  ResearchContractError,
  normalizeResearchRequest,
  normalizeResearchResult,
} from './research-contract.mjs';

const hasRequiredValue = (data, field) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (!Object.prototype.hasOwnProperty.call(data, field)) return false;
  const value = data[field];
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return true;
};

/**
 * Research result.items are records admitted to the production Data stage.
 * Auxiliary facts may remain in summary/sources, but every persisted SUCCESS
 * item must satisfy every request.requiredFields value expected by Data.
 */
export function admitResearchResultForData({ request, result } = {}) {
  const normalizedRequest = normalizeResearchRequest(request);
  const requiredFields = normalizedRequest.requiredFields;

  // This gate only narrows results for an explicit downstream Data contract.
  // Without required fields the already-accepted Research result is preserved.
  if (requiredFields.length === 0) return result;

  const normalizedResult = normalizeResearchResult(result);
  if (normalizedResult.status !== 'SUCCESS') return normalizedResult;

  const admittedItems = normalizedResult.items.filter((item) =>
    requiredFields.every((field) => hasRequiredValue(item.data, field))
  );

  if (admittedItems.length === 0) {
    throw new ResearchContractError(
      'Research SUCCESS contains no item satisfying every request.requiredFields entry',
      { code: 'REQUIRED_FIELDS_NOT_PROVEN', path: 'result.items' },
    );
  }

  if (admittedItems.length === normalizedResult.items.length) return normalizedResult;

  return Object.freeze({
    ...normalizedResult,
    items: Object.freeze(admittedItems),
  });
}
