import {
  type FragmentDefinitionNode,
  GraphQLError,
  Kind,
  type SelectionSetNode,
  type ValidationContext,
  type ValidationRule,
} from "graphql";

export interface QueryLimits {
  readonly maxDepth: number;
  readonly maxCost: number;
}

export const DEFAULT_QUERY_LIMITS: QueryLimits = { maxDepth: 8, maxCost: 500 };

type Fragments = ReadonlyMap<string, FragmentDefinitionNode>;

function fragmentsOf(context: ValidationContext): Fragments {
  const map = new Map<string, FragmentDefinitionNode>();
  for (const definition of context.getDocument().definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) map.set(definition.name.value, definition);
  }
  return map;
}

/**
 * Walks a selection set and returns its depth and field count. Fragments are expanded, and a
 * fragment already on the current path counts as zero so a cycle cannot loop. Both walks stop
 * as soon as a limit is passed, so a hostile query is rejected without being fully traversed.
 */
function measure(
  selections: SelectionSetNode,
  fragments: Fragments,
  onPath: ReadonlySet<string>,
  budget: { remaining: number },
): { depth: number; cost: number } {
  let depth = 0;
  let cost = 0;
  for (const selection of selections.selections) {
    if (budget.remaining < 0) break;
    if (selection.kind === Kind.FIELD) {
      budget.remaining -= 1;
      const inner = selection.selectionSet
        ? measure(selection.selectionSet, fragments, onPath, budget)
        : { depth: 0, cost: 0 };
      depth = Math.max(depth, 1 + inner.depth);
      cost += 1 + inner.cost;
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      const inner = measure(selection.selectionSet, fragments, onPath, budget);
      depth = Math.max(depth, inner.depth);
      cost += inner.cost;
    } else {
      const name = selection.name.value;
      const fragment = fragments.get(name);
      if (fragment === undefined || onPath.has(name)) continue;
      const inner = measure(fragment.selectionSet, fragments, new Set([...onPath, name]), budget);
      depth = Math.max(depth, inner.depth);
      cost += inner.cost;
    }
  }
  return { depth, cost };
}

/** Rejects an operation that is nested too deeply or selects too many fields. */
export function queryLimitsRule(limits: QueryLimits): ValidationRule {
  return (context) => ({
    OperationDefinition(node) {
      const fragments = fragmentsOf(context);
      // Walk at most twice the cost limit so the check stays cheap on a huge document.
      const budget = { remaining: limits.maxCost * 2 };
      const { depth, cost } = measure(node.selectionSet, fragments, new Set(), budget);
      if (depth > limits.maxDepth) {
        context.reportError(
          new GraphQLError(`Query is nested too deeply (limit ${limits.maxDepth})`, {
            nodes: node,
            extensions: { code: "QUERY_TOO_DEEP" },
          }),
        );
      } else if (cost > limits.maxCost) {
        context.reportError(
          new GraphQLError(`Query is too expensive (limit ${limits.maxCost} fields)`, {
            nodes: node,
            extensions: { code: "QUERY_TOO_COSTLY" },
          }),
        );
      }
    },
  });
}

/** Rejects `__schema` and `__type` lookups. `__typename` stays allowed. */
export const noIntrospectionRule: ValidationRule = (context) => ({
  Field(node) {
    const name = node.name.value;
    if (name === "__schema" || name === "__type") {
      context.reportError(
        new GraphQLError("Introspection is disabled", {
          nodes: node,
          extensions: { code: "INTROSPECTION_DISABLED" },
        }),
      );
    }
  },
});
