import type * as Schema from "@gym/graphql-schema";
import { typeDefs } from "@gym/graphql-schema";
import { buildSchema, type GraphQLSchema } from "graphql";

type Unwrap<V> = NonNullable<V> extends readonly (infer U)[] ? NonNullable<U> : NonNullable<V>;
type IsObject<V> = Unwrap<V> extends object ? true : false;
type FieldNames<T> = Exclude<keyof T, "__typename">;

/** What may be selected on an object type. Leaf fields take `true`, object fields take a nested selection. */
export type Sel<T> = {
  readonly [K in FieldNames<T>]?: IsObject<T[K]> extends true ? Sel<Unwrap<T[K]>> : true;
};

/** Rejects any key the schema type does not have, which a plain constraint on a generic would let through. */
export type Strict<T, S> = {
  readonly [K in keyof S]: K extends FieldNames<T>
    ? S[K] extends true
      ? true
      : Strict<Unwrap<T[K]>, S[K]>
    : never;
};

type Wrap<V, R> = (V extends readonly unknown[] ? R[] : R) | (null extends V ? null : never);

/** The data a selection returns. Only the selected fields exist on the type. */
export type Picked<T, S> = {
  [K in keyof S & keyof T]-?: S[K] extends true
    ? Required<T>[K]
    : Wrap<Required<T>[K], Picked<Unwrap<T[K]>, S[K]>>;
};

/** Arguments per root field, from the generated types. A field missing here takes none. */
interface RootArgs {
  Query: {
    auditEvents: Schema.QueryAuditEventsArgs;
    discounts: Schema.QueryDiscountsArgs;
    invoices: Schema.QueryInvoicesArgs;
    member: Schema.QueryMemberArgs;
    members: Schema.QueryMembersArgs;
    membershipPeriods: Schema.QueryMembershipPeriodsArgs;
    payments: Schema.QueryPaymentsArgs;
    previewPayment: Schema.QueryPreviewPaymentArgs;
    publicTenant: Schema.QueryPublicTenantArgs;
    visits: Schema.QueryVisitsArgs;
  };
  Mutation: {
    addDiscount: Schema.MutationAddDiscountArgs;
    createMember: Schema.MutationCreateMemberArgs;
    endDiscount: Schema.MutationEndDiscountArgs;
    inviteUser: Schema.MutationInviteUserArgs;
    recordPayment: Schema.MutationRecordPaymentArgs;
    recordScan: Schema.MutationRecordScanArgs;
    selectGym: Schema.MutationSelectGymArgs;
    setRole: Schema.MutationSetRoleArgs;
    updateMember: Schema.MutationUpdateMemberArgs;
    updatePlan: Schema.MutationUpdatePlanArgs;
    updateSettings: Schema.MutationUpdateSettingsArgs;
    voidInvoice: Schema.MutationVoidInvoiceArgs;
    voidPayment: Schema.MutationVoidPaymentArgs;
  };
}
type ArgsOf<Root extends keyof RootArgs, K extends string> = K extends keyof RootArgs[Root]
  ? RootArgs[Root][K]
  : never;

export type OperationKind = "query" | "mutation";

/** A request ready to send. `Data` is only a type, the value never exists at runtime. */
export interface Operation<Data> {
  readonly kind: OperationKind;
  readonly name: string;
  readonly document: string;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly __data?: Data;
}

export type DataOf<O> = O extends Operation<infer D> ? D : never;

/** One root field: `true` for a scalar without arguments, otherwise its arguments and selection. */
export type RootEntry = true | { readonly args?: object; readonly select?: object };

let cachedSchema: GraphQLSchema | undefined;

function schema(): GraphQLSchema {
  cachedSchema ??= buildSchema(typeDefs);
  return cachedSchema;
}

function printSelection(select: object): string {
  const parts = Object.entries(select).map(([field, value]) =>
    value === true ? field : `${field} { ${printSelection(value as object)} }`,
  );
  return parts.join(" ");
}

function argTypes(kind: OperationKind, field: string): Record<string, string> {
  const root = kind === "query" ? schema().getQueryType() : schema().getMutationType();
  const definition = root?.getFields()[field];
  if (definition === undefined) throw new Error(`Unknown ${kind} field: ${field}`);
  return Object.fromEntries(definition.args.map((arg) => [arg.name, String(arg.type)]));
}

/** Builds the document text and variables. Values travel as variables, never inside the text. */
export function buildOperation<Data>(
  kind: OperationKind,
  name: string,
  roots: Readonly<Record<string, RootEntry>>,
): Operation<Data> {
  const declarations: string[] = [];
  const variables: Record<string, unknown> = {};
  const fields = Object.entries(roots).map(([field, entry]) => {
    const spec = entry === true ? {} : entry;
    const types = argTypes(kind, field);
    const used: string[] = [];
    for (const [arg, value] of Object.entries(spec.args ?? {})) {
      const type = types[arg];
      if (type === undefined) throw new Error(`Unknown argument ${arg} on ${field}`);
      const variable = `${field}_${arg}`;
      declarations.push(`$${variable}: ${type}`);
      variables[variable] = value;
      used.push(`${arg}: $${variable}`);
    }
    const args = used.length === 0 ? "" : `(${used.join(", ")})`;
    const body = spec.select === undefined ? "" : ` { ${printSelection(spec.select)} }`;
    return `${field}${args}${body}`;
  });
  const header = declarations.length === 0 ? name : `${name}(${declarations.join(", ")})`;
  return { kind, name, document: `${kind} ${header} { ${fields.join(" ")} }`, variables };
}

type RootFor<R, Root extends keyof RootArgs> = {
  readonly [K in FieldNames<R> & string]?:
    | (IsObject<R[K]> extends true ? never : true)
    | {
        readonly args?: ArgsOf<Root, K>;
        readonly select?: IsObject<R[K]> extends true ? Sel<Unwrap<R[K]>> : never;
      };
};

type RootStrict<R, S> = {
  readonly [K in keyof S]: K extends FieldNames<R>
    ? S[K] extends true
      ? true
      : S[K] extends { select: infer Sub }
        ? { readonly args?: unknown; readonly select: Strict<Unwrap<R[K]>, Sub> }
        : S[K]
    : never;
};

type RootData<R, S> = {
  [K in keyof S & keyof R]-?: S[K] extends { select: infer Sub }
    ? Wrap<Required<R>[K], Picked<Unwrap<R[K]>, Sub>>
    : Required<R>[K];
};

/** A typed query. Selecting a field the schema does not have fails the type check. */
export function query<S extends RootFor<Schema.Query, "Query">>(
  name: string,
  roots: S & RootStrict<Schema.Query, S>,
): Operation<RootData<Schema.Query, S>> {
  return buildOperation("query", name, roots as Record<string, RootEntry>);
}

/** A typed mutation. */
export function mutation<S extends RootFor<Schema.Mutation, "Mutation">>(
  name: string,
  roots: S & RootStrict<Schema.Mutation, S>,
): Operation<RootData<Schema.Mutation, S>> {
  return buildOperation("mutation", name, roots as Record<string, RootEntry>);
}
