// Generated from schema.graphql. Do not edit. Run `pnpm --filter @gym/graphql-schema generate`.
import type { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  Date: { input: string; output: string; }
  DateTime: { input: string; output: string; }
  JSON: { input: unknown; output: unknown; }
};

export type Allocation = {
  __typename?: 'Allocation';
  amount: Scalars['Int']['output'];
  invoiceId: Scalars['ID']['output'];
};

export type AuditEvent = {
  __typename?: 'AuditEvent';
  action: Scalars['String']['output'];
  actorUserId?: Maybe<Scalars['ID']['output']>;
  after?: Maybe<Scalars['JSON']['output']>;
  before?: Maybe<Scalars['JSON']['output']>;
  entityId: Scalars['ID']['output'];
  entityType: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  occurredAt: Scalars['DateTime']['output'];
};

export type AuditEventPage = {
  __typename?: 'AuditEventPage';
  items: Array<AuditEvent>;
  nextCursor?: Maybe<Scalars['String']['output']>;
};

export type Branding = {
  __typename?: 'Branding';
  contactAddress?: Maybe<Scalars['String']['output']>;
  contactEmail?: Maybe<Scalars['String']['output']>;
  contactPhone?: Maybe<Scalars['String']['output']>;
  logoUrl?: Maybe<Scalars['String']['output']>;
  primaryColor?: Maybe<Scalars['String']['output']>;
};

export type Discount = {
  __typename?: 'Discount';
  amount: Scalars['Int']['output'];
  endsOn?: Maybe<Scalars['Date']['output']>;
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  isConsumed: Scalars['Boolean']['output'];
  isRecurring: Scalars['Boolean']['output'];
  kind: DiscountKind;
  memberId: Scalars['ID']['output'];
  reason?: Maybe<Scalars['String']['output']>;
  referralSide?: Maybe<ReferralSide>;
  sourceMember?: Maybe<Member>;
  startsOn: Scalars['Date']['output'];
};

export type DiscountInput = {
  amount: Scalars['Int']['input'];
  isRecurring: Scalars['Boolean']['input'];
  memberId: Scalars['ID']['input'];
  reason: Scalars['String']['input'];
  startsOn?: InputMaybe<Scalars['Date']['input']>;
};

export type DiscountKind =
  | 'MANUAL'
  | 'REFERRAL';

export type DiscountPayload = {
  __typename?: 'DiscountPayload';
  discount?: Maybe<Discount>;
  errors: Array<UserError>;
};

export type ErrorCode =
  | 'ALREADY_VOID'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'HAS_ALLOCATIONS'
  | 'INVALID_INPUT'
  | 'LAST_OWNER'
  | 'NOT_FOUND';

export type Gym = {
  __typename?: 'Gym';
  logoUrl?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  roles: Array<Role>;
  tenantId: Scalars['ID']['output'];
};

export type Invoice = {
  __typename?: 'Invoice';
  amountDue: Scalars['Int']['output'];
  dueDate: Scalars['Date']['output'];
  id: Scalars['ID']['output'];
  isPaid: Scalars['Boolean']['output'];
  isVoid: Scalars['Boolean']['output'];
  lines: Array<InvoiceLine>;
  memberId: Scalars['ID']['output'];
  periodEnd: Scalars['Date']['output'];
  periodStart: Scalars['Date']['output'];
  total: Scalars['Int']['output'];
  voidReason?: Maybe<Scalars['String']['output']>;
};

export type InvoiceLine = {
  __typename?: 'InvoiceLine';
  amount: Scalars['Int']['output'];
  description: Scalars['String']['output'];
  discountId?: Maybe<Scalars['ID']['output']>;
  id: Scalars['ID']['output'];
  lineType: InvoiceLineType;
};

export type InvoiceLineType =
  | 'ADMISSION'
  | 'DISCOUNT'
  | 'MEMBERSHIP';

export type InvoicePage = {
  __typename?: 'InvoicePage';
  items: Array<Invoice>;
  nextCursor?: Maybe<Scalars['String']['output']>;
};

export type InvoicePayload = {
  __typename?: 'InvoicePayload';
  errors: Array<UserError>;
  invoice?: Maybe<Invoice>;
};

export type Me = {
  __typename?: 'Me';
  email: Scalars['String']['output'];
  memberId?: Maybe<Scalars['ID']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  permissions: Array<Scalars['String']['output']>;
  roles: Array<Role>;
  userId: Scalars['ID']['output'];
};

export type Member = {
  __typename?: 'Member';
  balanceDue: Scalars['Int']['output'];
  barcode: Scalars['String']['output'];
  billingDay: Scalars['Int']['output'];
  credit: Scalars['Int']['output'];
  email: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  joinedOn: Scalars['Date']['output'];
  leftOn?: Maybe<Scalars['Date']['output']>;
  memberNo: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  paidThrough?: Maybe<Scalars['Date']['output']>;
  phone?: Maybe<Scalars['String']['output']>;
  photoRef?: Maybe<Scalars['String']['output']>;
  plan: Plan;
  referredBy?: Maybe<Member>;
  standing: Standing;
  status: MemberStatus;
  totalPaid: Scalars['Int']['output'];
  visitsLastMonth: Scalars['Int']['output'];
  visitsThisMonth: Scalars['Int']['output'];
};

export type MemberInput = {
  email: Scalars['String']['input'];
  joinedOn: Scalars['Date']['input'];
  name: Scalars['String']['input'];
  phone?: InputMaybe<Scalars['String']['input']>;
  photoRef?: InputMaybe<Scalars['String']['input']>;
  planId: Scalars['ID']['input'];
  referredById?: InputMaybe<Scalars['ID']['input']>;
};

export type MemberPage = {
  __typename?: 'MemberPage';
  items: Array<Member>;
  nextCursor?: Maybe<Scalars['String']['output']>;
};

export type MemberPatch = {
  name?: InputMaybe<Scalars['String']['input']>;
  phone?: InputMaybe<Scalars['String']['input']>;
  photoRef?: InputMaybe<Scalars['String']['input']>;
  reason?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<MemberStatus>;
};

export type MemberPayload = {
  __typename?: 'MemberPayload';
  errors: Array<UserError>;
  member?: Maybe<Member>;
};

export type MemberStatus =
  | 'ACTIVE'
  | 'CANCELLED'
  | 'PAUSED';

export type MembershipPeriod = {
  __typename?: 'MembershipPeriod';
  changedBy?: Maybe<Scalars['ID']['output']>;
  id: Scalars['ID']['output'];
  memberId: Scalars['ID']['output'];
  planId: Scalars['ID']['output'];
  reason?: Maybe<Scalars['String']['output']>;
  status: MemberStatus;
  validFrom: Scalars['Date']['output'];
  validTo?: Maybe<Scalars['Date']['output']>;
};

export type Mutation = {
  __typename?: 'Mutation';
  addDiscount: DiscountPayload;
  createMember: MemberPayload;
  endDiscount: DiscountPayload;
  inviteUser: StaffPayload;
  recordPayment: PaymentPayload;
  recordScan: ScanPayload;
  removeAccess: StaffPayload;
  selectGym: SelectGymPayload;
  setRole: StaffPayload;
  signIn: SignInPayload;
  signOut: Scalars['Boolean']['output'];
  updateMember: MemberPayload;
  updatePlan: PlanPayload;
  updateSettings: TenantPayload;
  voidInvoice: InvoicePayload;
  voidPayment: PaymentPayload;
};


export type MutationAddDiscountArgs = {
  input: DiscountInput;
};


export type MutationCreateMemberArgs = {
  input: MemberInput;
};


export type MutationEndDiscountArgs = {
  id: Scalars['ID']['input'];
  reason: Scalars['String']['input'];
};


export type MutationInviteUserArgs = {
  email: Scalars['String']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  role: Role;
};


export type MutationRecordPaymentArgs = {
  input: RecordPaymentInput;
};


export type MutationRecordScanArgs = {
  barcode: Scalars['String']['input'];
  source?: InputMaybe<ScanSource>;
};


export type MutationRemoveAccessArgs = {
  userId: Scalars['ID']['input'];
};


export type MutationSelectGymArgs = {
  tenantId: Scalars['ID']['input'];
};


export type MutationSetRoleArgs = {
  isOn: Scalars['Boolean']['input'];
  role: Role;
  userId: Scalars['ID']['input'];
};


export type MutationSignInArgs = {
  idToken: Scalars['String']['input'];
};


export type MutationUpdateMemberArgs = {
  id: Scalars['ID']['input'];
  patch: MemberPatch;
};


export type MutationUpdatePlanArgs = {
  id: Scalars['ID']['input'];
  input: PlanInput;
};


export type MutationUpdateSettingsArgs = {
  input: SettingsInput;
};


export type MutationVoidInvoiceArgs = {
  id: Scalars['ID']['input'];
  reason: Scalars['String']['input'];
};


export type MutationVoidPaymentArgs = {
  id: Scalars['ID']['input'];
  reason: Scalars['String']['input'];
};

export type PageInput = {
  cursor?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
};

export type Payment = {
  __typename?: 'Payment';
  allocations: Array<Allocation>;
  amount: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  isVoid: Scalars['Boolean']['output'];
  memberId: Scalars['ID']['output'];
  method: PaymentMethod;
  paidOn: Scalars['Date']['output'];
  proofLink?: Maybe<Scalars['String']['output']>;
  recordedBy: Scalars['ID']['output'];
  submittedAt: Scalars['DateTime']['output'];
  voidReason?: Maybe<Scalars['String']['output']>;
};

export type PaymentMethod =
  | 'BANK_TRANSFER'
  | 'CARD'
  | 'CASH';

export type PaymentPage = {
  __typename?: 'PaymentPage';
  items: Array<Payment>;
  nextCursor?: Maybe<Scalars['String']['output']>;
};

export type PaymentPayload = {
  __typename?: 'PaymentPayload';
  errors: Array<UserError>;
  member?: Maybe<Member>;
  payment?: Maybe<Payment>;
};

export type PaymentPreview = {
  __typename?: 'PaymentPreview';
  allocations: Array<Allocation>;
  creditAfter: Scalars['Int']['output'];
  paidThroughAfter?: Maybe<Scalars['Date']['output']>;
};

export type Plan = {
  __typename?: 'Plan';
  admissionFee: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  key: Scalars['String']['output'];
  monthlyFee: Scalars['Int']['output'];
  name: Scalars['String']['output'];
};

export type PlanInput = {
  admissionFee: Scalars['Int']['input'];
  monthlyFee: Scalars['Int']['input'];
  name: Scalars['String']['input'];
};

export type PlanPayload = {
  __typename?: 'PlanPayload';
  errors: Array<UserError>;
  plan?: Maybe<Plan>;
};

export type PublicTenant = {
  __typename?: 'PublicTenant';
  branding: Branding;
  name: Scalars['String']['output'];
};

export type Query = {
  __typename?: 'Query';
  auditEvents: AuditEventPage;
  discounts: Array<Discount>;
  health: Scalars['String']['output'];
  invoices: InvoicePage;
  me: Me;
  member?: Maybe<Member>;
  members: MemberPage;
  membershipPeriods: Array<MembershipPeriod>;
  myGyms: Array<Gym>;
  payments: PaymentPage;
  plans: Array<Plan>;
  previewPayment: PaymentPreview;
  publicTenant?: Maybe<PublicTenant>;
  staff: Array<StaffUser>;
  tenant: Tenant;
  visits: VisitPage;
};


export type QueryAuditEventsArgs = {
  entityId?: InputMaybe<Scalars['ID']['input']>;
  entityType?: InputMaybe<Scalars['String']['input']>;
  page?: InputMaybe<PageInput>;
};


export type QueryDiscountsArgs = {
  memberId: Scalars['ID']['input'];
};


export type QueryInvoicesArgs = {
  memberId: Scalars['ID']['input'];
  page?: InputMaybe<PageInput>;
};


export type QueryMemberArgs = {
  id: Scalars['ID']['input'];
};


export type QueryMembersArgs = {
  page?: InputMaybe<PageInput>;
  search?: InputMaybe<Scalars['String']['input']>;
};


export type QueryMembershipPeriodsArgs = {
  memberId: Scalars['ID']['input'];
};


export type QueryPaymentsArgs = {
  memberId: Scalars['ID']['input'];
  page?: InputMaybe<PageInput>;
};


export type QueryPreviewPaymentArgs = {
  amount: Scalars['Int']['input'];
  memberId: Scalars['ID']['input'];
};


export type QueryPublicTenantArgs = {
  subdomain: Scalars['String']['input'];
};


export type QueryVisitsArgs = {
  memberId: Scalars['ID']['input'];
  page?: InputMaybe<PageInput>;
};

export type RecordPaymentInput = {
  amount: Scalars['Int']['input'];
  clientRequestId: Scalars['ID']['input'];
  memberId: Scalars['ID']['input'];
  method: PaymentMethod;
  paidOn?: InputMaybe<Scalars['Date']['input']>;
  proofLink?: InputMaybe<Scalars['String']['input']>;
};

export type ReferralSide =
  | 'REFERRED'
  | 'REFERRER';

export type Role =
  | 'MEMBER'
  | 'OWNER'
  | 'STAFF';

export type ScanPayload = {
  __typename?: 'ScanPayload';
  errors: Array<UserError>;
  member?: Maybe<Member>;
  visit?: Maybe<Visit>;
};

export type ScanSource =
  | 'MANUAL'
  | 'STAFF_APP';

export type SelectGymPayload = {
  __typename?: 'SelectGymPayload';
  errors: Array<UserError>;
  me?: Maybe<Me>;
  tenant?: Maybe<Tenant>;
};

export type SettingsInput = {
  dupWindowMin?: InputMaybe<Scalars['Int']['input']>;
  redDaysAfter?: InputMaybe<Scalars['Int']['input']>;
  referredAmount?: InputMaybe<Scalars['Int']['input']>;
  referredIsRecurring?: InputMaybe<Scalars['Boolean']['input']>;
  referrerAmount?: InputMaybe<Scalars['Int']['input']>;
  referrerIsRecurring?: InputMaybe<Scalars['Boolean']['input']>;
  warnDaysBefore?: InputMaybe<Scalars['Int']['input']>;
};

export type SignInPayload = {
  __typename?: 'SignInPayload';
  errors: Array<UserError>;
  expiresAt?: Maybe<Scalars['DateTime']['output']>;
  gyms: Array<Gym>;
  token?: Maybe<Scalars['String']['output']>;
};

export type StaffPayload = {
  __typename?: 'StaffPayload';
  errors: Array<UserError>;
  user?: Maybe<StaffUser>;
};

export type StaffUser = {
  __typename?: 'StaffUser';
  email: Scalars['String']['output'];
  hasSignedIn: Scalars['Boolean']['output'];
  name?: Maybe<Scalars['String']['output']>;
  roles: Array<Role>;
  userId: Scalars['ID']['output'];
};

export type Standing =
  | 'DUE_SOON'
  | 'INACTIVE'
  | 'OVERDUE'
  | 'PAID';

export type Tenant = {
  __typename?: 'Tenant';
  branding: Branding;
  currency: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  settings: TenantSettings;
  subdomain: Scalars['String']['output'];
  timezone: Scalars['String']['output'];
};

export type TenantPayload = {
  __typename?: 'TenantPayload';
  errors: Array<UserError>;
  tenant?: Maybe<Tenant>;
};

export type TenantSettings = {
  __typename?: 'TenantSettings';
  dupWindowMin: Scalars['Int']['output'];
  redDaysAfter: Scalars['Int']['output'];
  referredAmount: Scalars['Int']['output'];
  referredIsRecurring: Scalars['Boolean']['output'];
  referrerAmount: Scalars['Int']['output'];
  referrerIsRecurring: Scalars['Boolean']['output'];
  warnDaysBefore: Scalars['Int']['output'];
};

export type UserError = {
  __typename?: 'UserError';
  code: ErrorCode;
  field?: Maybe<Scalars['String']['output']>;
  message: Scalars['String']['output'];
};

export type Visit = {
  __typename?: 'Visit';
  id: Scalars['ID']['output'];
  isDuplicate: Scalars['Boolean']['output'];
  localDate: Scalars['Date']['output'];
  memberId: Scalars['ID']['output'];
  scannedAt: Scalars['DateTime']['output'];
  source: ScanSource;
  statusAtScan: Standing;
};

export type VisitPage = {
  __typename?: 'VisitPage';
  items: Array<Visit>;
  nextCursor?: Maybe<Scalars['String']['output']>;
};

export type WithIndex<TObject> = TObject & Record<string, any>;
export type ResolversObject<TObject> = WithIndex<TObject>;

export type ResolverTypeWrapper<T> = Promise<T> | T;


export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = Record<PropertyKey, never>, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;





/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = ResolversObject<{
  Allocation: ResolverTypeWrapper<Allocation>;
  AuditEvent: ResolverTypeWrapper<AuditEvent>;
  AuditEventPage: ResolverTypeWrapper<AuditEventPage>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  Branding: ResolverTypeWrapper<Branding>;
  Date: ResolverTypeWrapper<Scalars['Date']['output']>;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  Discount: ResolverTypeWrapper<Discount>;
  DiscountInput: DiscountInput;
  DiscountKind: DiscountKind;
  DiscountPayload: ResolverTypeWrapper<DiscountPayload>;
  ErrorCode: ErrorCode;
  Gym: ResolverTypeWrapper<Gym>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  Invoice: ResolverTypeWrapper<Invoice>;
  InvoiceLine: ResolverTypeWrapper<InvoiceLine>;
  InvoiceLineType: InvoiceLineType;
  InvoicePage: ResolverTypeWrapper<InvoicePage>;
  InvoicePayload: ResolverTypeWrapper<InvoicePayload>;
  JSON: ResolverTypeWrapper<Scalars['JSON']['output']>;
  Me: ResolverTypeWrapper<Me>;
  Member: ResolverTypeWrapper<Member>;
  MemberInput: MemberInput;
  MemberPage: ResolverTypeWrapper<MemberPage>;
  MemberPatch: MemberPatch;
  MemberPayload: ResolverTypeWrapper<MemberPayload>;
  MemberStatus: MemberStatus;
  MembershipPeriod: ResolverTypeWrapper<MembershipPeriod>;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  PageInput: PageInput;
  Payment: ResolverTypeWrapper<Payment>;
  PaymentMethod: PaymentMethod;
  PaymentPage: ResolverTypeWrapper<PaymentPage>;
  PaymentPayload: ResolverTypeWrapper<PaymentPayload>;
  PaymentPreview: ResolverTypeWrapper<PaymentPreview>;
  Plan: ResolverTypeWrapper<Plan>;
  PlanInput: PlanInput;
  PlanPayload: ResolverTypeWrapper<PlanPayload>;
  PublicTenant: ResolverTypeWrapper<PublicTenant>;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  RecordPaymentInput: RecordPaymentInput;
  ReferralSide: ReferralSide;
  Role: Role;
  ScanPayload: ResolverTypeWrapper<ScanPayload>;
  ScanSource: ScanSource;
  SelectGymPayload: ResolverTypeWrapper<SelectGymPayload>;
  SettingsInput: SettingsInput;
  SignInPayload: ResolverTypeWrapper<SignInPayload>;
  StaffPayload: ResolverTypeWrapper<StaffPayload>;
  StaffUser: ResolverTypeWrapper<StaffUser>;
  Standing: Standing;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  Tenant: ResolverTypeWrapper<Tenant>;
  TenantPayload: ResolverTypeWrapper<TenantPayload>;
  TenantSettings: ResolverTypeWrapper<TenantSettings>;
  UserError: ResolverTypeWrapper<UserError>;
  Visit: ResolverTypeWrapper<Visit>;
  VisitPage: ResolverTypeWrapper<VisitPage>;
}>;

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = ResolversObject<{
  Allocation: Allocation;
  AuditEvent: AuditEvent;
  AuditEventPage: AuditEventPage;
  Boolean: Scalars['Boolean']['output'];
  Branding: Branding;
  Date: Scalars['Date']['output'];
  DateTime: Scalars['DateTime']['output'];
  Discount: Discount;
  DiscountInput: DiscountInput;
  DiscountPayload: DiscountPayload;
  Gym: Gym;
  ID: Scalars['ID']['output'];
  Int: Scalars['Int']['output'];
  Invoice: Invoice;
  InvoiceLine: InvoiceLine;
  InvoicePage: InvoicePage;
  InvoicePayload: InvoicePayload;
  JSON: Scalars['JSON']['output'];
  Me: Me;
  Member: Member;
  MemberInput: MemberInput;
  MemberPage: MemberPage;
  MemberPatch: MemberPatch;
  MemberPayload: MemberPayload;
  MembershipPeriod: MembershipPeriod;
  Mutation: Record<PropertyKey, never>;
  PageInput: PageInput;
  Payment: Payment;
  PaymentPage: PaymentPage;
  PaymentPayload: PaymentPayload;
  PaymentPreview: PaymentPreview;
  Plan: Plan;
  PlanInput: PlanInput;
  PlanPayload: PlanPayload;
  PublicTenant: PublicTenant;
  Query: Record<PropertyKey, never>;
  RecordPaymentInput: RecordPaymentInput;
  ScanPayload: ScanPayload;
  SelectGymPayload: SelectGymPayload;
  SettingsInput: SettingsInput;
  SignInPayload: SignInPayload;
  StaffPayload: StaffPayload;
  StaffUser: StaffUser;
  String: Scalars['String']['output'];
  Tenant: Tenant;
  TenantPayload: TenantPayload;
  TenantSettings: TenantSettings;
  UserError: UserError;
  Visit: Visit;
  VisitPage: VisitPage;
}>;

export type AllocationResolvers<ContextType = any, ParentType extends ResolversParentTypes['Allocation'] = ResolversParentTypes['Allocation']> = ResolversObject<{
  amount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  invoiceId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
}>;

export type AuditEventResolvers<ContextType = any, ParentType extends ResolversParentTypes['AuditEvent'] = ResolversParentTypes['AuditEvent']> = ResolversObject<{
  action?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  actorUserId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  after?: Resolver<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  before?: Resolver<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  entityId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  entityType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  occurredAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
}>;

export type AuditEventPageResolvers<ContextType = any, ParentType extends ResolversParentTypes['AuditEventPage'] = ResolversParentTypes['AuditEventPage']> = ResolversObject<{
  items?: Resolver<Array<ResolversTypes['AuditEvent']>, ParentType, ContextType>;
  nextCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
}>;

export type BrandingResolvers<ContextType = any, ParentType extends ResolversParentTypes['Branding'] = ResolversParentTypes['Branding']> = ResolversObject<{
  contactAddress?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  contactEmail?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  contactPhone?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  logoUrl?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  primaryColor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
}>;

export interface DateScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['Date'], any> {
  name: 'Date';
}

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export type DiscountResolvers<ContextType = any, ParentType extends ResolversParentTypes['Discount'] = ResolversParentTypes['Discount']> = ResolversObject<{
  amount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  endsOn?: Resolver<Maybe<ResolversTypes['Date']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isConsumed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isRecurring?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  kind?: Resolver<ResolversTypes['DiscountKind'], ParentType, ContextType>;
  memberId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  reason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  referralSide?: Resolver<Maybe<ResolversTypes['ReferralSide']>, ParentType, ContextType>;
  sourceMember?: Resolver<Maybe<ResolversTypes['Member']>, ParentType, ContextType>;
  startsOn?: Resolver<ResolversTypes['Date'], ParentType, ContextType>;
}>;

export type DiscountPayloadResolvers<ContextType = any, ParentType extends ResolversParentTypes['DiscountPayload'] = ResolversParentTypes['DiscountPayload']> = ResolversObject<{
  discount?: Resolver<Maybe<ResolversTypes['Discount']>, ParentType, ContextType>;
  errors?: Resolver<Array<ResolversTypes['UserError']>, ParentType, ContextType>;
}>;

export type GymResolvers<ContextType = any, ParentType extends ResolversParentTypes['Gym'] = ResolversParentTypes['Gym']> = ResolversObject<{
  logoUrl?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  roles?: Resolver<Array<ResolversTypes['Role']>, ParentType, ContextType>;
  tenantId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
}>;

export type InvoiceResolvers<ContextType = any, ParentType extends ResolversParentTypes['Invoice'] = ResolversParentTypes['Invoice']> = ResolversObject<{
  amountDue?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  dueDate?: Resolver<ResolversTypes['Date'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isPaid?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isVoid?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  lines?: Resolver<Array<ResolversTypes['InvoiceLine']>, ParentType, ContextType>;
  memberId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  periodEnd?: Resolver<ResolversTypes['Date'], ParentType, ContextType>;
  periodStart?: Resolver<ResolversTypes['Date'], ParentType, ContextType>;
  total?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  voidReason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
}>;

export type InvoiceLineResolvers<ContextType = any, ParentType extends ResolversParentTypes['InvoiceLine'] = ResolversParentTypes['InvoiceLine']> = ResolversObject<{
  amount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  discountId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  lineType?: Resolver<ResolversTypes['InvoiceLineType'], ParentType, ContextType>;
}>;

export type InvoicePageResolvers<ContextType = any, ParentType extends ResolversParentTypes['InvoicePage'] = ResolversParentTypes['InvoicePage']> = ResolversObject<{
  items?: Resolver<Array<ResolversTypes['Invoice']>, ParentType, ContextType>;
  nextCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
}>;

export type InvoicePayloadResolvers<ContextType = any, ParentType extends ResolversParentTypes['InvoicePayload'] = ResolversParentTypes['InvoicePayload']> = ResolversObject<{
  errors?: Resolver<Array<ResolversTypes['UserError']>, ParentType, ContextType>;
  invoice?: Resolver<Maybe<ResolversTypes['Invoice']>, ParentType, ContextType>;
}>;

export interface JsonScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['JSON'], any> {
  name: 'JSON';
}

export type MeResolvers<ContextType = any, ParentType extends ResolversParentTypes['Me'] = ResolversParentTypes['Me']> = ResolversObject<{
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  memberId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  name?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  permissions?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  roles?: Resolver<Array<ResolversTypes['Role']>, ParentType, ContextType>;
  userId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
}>;

export type MemberResolvers<ContextType = any, ParentType extends ResolversParentTypes['Member'] = ResolversParentTypes['Member']> = ResolversObject<{
  balanceDue?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  barcode?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  billingDay?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  credit?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  joinedOn?: Resolver<ResolversTypes['Date'], ParentType, ContextType>;
  leftOn?: Resolver<Maybe<ResolversTypes['Date']>, ParentType, ContextType>;
  memberNo?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  name?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  paidThrough?: Resolver<Maybe<ResolversTypes['Date']>, ParentType, ContextType>;
  phone?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  photoRef?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  plan?: Resolver<ResolversTypes['Plan'], ParentType, ContextType>;
  referredBy?: Resolver<Maybe<ResolversTypes['Member']>, ParentType, ContextType>;
  standing?: Resolver<ResolversTypes['Standing'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['MemberStatus'], ParentType, ContextType>;
  totalPaid?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  visitsLastMonth?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  visitsThisMonth?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
}>;

export type MemberPageResolvers<ContextType = any, ParentType extends ResolversParentTypes['MemberPage'] = ResolversParentTypes['MemberPage']> = ResolversObject<{
  items?: Resolver<Array<ResolversTypes['Member']>, ParentType, ContextType>;
  nextCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
}>;

export type MemberPayloadResolvers<ContextType = any, ParentType extends ResolversParentTypes['MemberPayload'] = ResolversParentTypes['MemberPayload']> = ResolversObject<{
  errors?: Resolver<Array<ResolversTypes['UserError']>, ParentType, ContextType>;
  member?: Resolver<Maybe<ResolversTypes['Member']>, ParentType, ContextType>;
}>;

export type MembershipPeriodResolvers<ContextType = any, ParentType extends ResolversParentTypes['MembershipPeriod'] = ResolversParentTypes['MembershipPeriod']> = ResolversObject<{
  changedBy?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  memberId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  planId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  reason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['MemberStatus'], ParentType, ContextType>;
  validFrom?: Resolver<ResolversTypes['Date'], ParentType, ContextType>;
  validTo?: Resolver<Maybe<ResolversTypes['Date']>, ParentType, ContextType>;
}>;

export type MutationResolvers<ContextType = any, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = ResolversObject<{
  addDiscount?: Resolver<ResolversTypes['DiscountPayload'], ParentType, ContextType, RequireFields<MutationAddDiscountArgs, 'input'>>;
  createMember?: Resolver<ResolversTypes['MemberPayload'], ParentType, ContextType, RequireFields<MutationCreateMemberArgs, 'input'>>;
  endDiscount?: Resolver<ResolversTypes['DiscountPayload'], ParentType, ContextType, RequireFields<MutationEndDiscountArgs, 'id' | 'reason'>>;
  inviteUser?: Resolver<ResolversTypes['StaffPayload'], ParentType, ContextType, RequireFields<MutationInviteUserArgs, 'email' | 'role'>>;
  recordPayment?: Resolver<ResolversTypes['PaymentPayload'], ParentType, ContextType, RequireFields<MutationRecordPaymentArgs, 'input'>>;
  recordScan?: Resolver<ResolversTypes['ScanPayload'], ParentType, ContextType, RequireFields<MutationRecordScanArgs, 'barcode' | 'source'>>;
  removeAccess?: Resolver<ResolversTypes['StaffPayload'], ParentType, ContextType, RequireFields<MutationRemoveAccessArgs, 'userId'>>;
  selectGym?: Resolver<ResolversTypes['SelectGymPayload'], ParentType, ContextType, RequireFields<MutationSelectGymArgs, 'tenantId'>>;
  setRole?: Resolver<ResolversTypes['StaffPayload'], ParentType, ContextType, RequireFields<MutationSetRoleArgs, 'isOn' | 'role' | 'userId'>>;
  signIn?: Resolver<ResolversTypes['SignInPayload'], ParentType, ContextType, RequireFields<MutationSignInArgs, 'idToken'>>;
  signOut?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  updateMember?: Resolver<ResolversTypes['MemberPayload'], ParentType, ContextType, RequireFields<MutationUpdateMemberArgs, 'id' | 'patch'>>;
  updatePlan?: Resolver<ResolversTypes['PlanPayload'], ParentType, ContextType, RequireFields<MutationUpdatePlanArgs, 'id' | 'input'>>;
  updateSettings?: Resolver<ResolversTypes['TenantPayload'], ParentType, ContextType, RequireFields<MutationUpdateSettingsArgs, 'input'>>;
  voidInvoice?: Resolver<ResolversTypes['InvoicePayload'], ParentType, ContextType, RequireFields<MutationVoidInvoiceArgs, 'id' | 'reason'>>;
  voidPayment?: Resolver<ResolversTypes['PaymentPayload'], ParentType, ContextType, RequireFields<MutationVoidPaymentArgs, 'id' | 'reason'>>;
}>;

export type PaymentResolvers<ContextType = any, ParentType extends ResolversParentTypes['Payment'] = ResolversParentTypes['Payment']> = ResolversObject<{
  allocations?: Resolver<Array<ResolversTypes['Allocation']>, ParentType, ContextType>;
  amount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isVoid?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  memberId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  method?: Resolver<ResolversTypes['PaymentMethod'], ParentType, ContextType>;
  paidOn?: Resolver<ResolversTypes['Date'], ParentType, ContextType>;
  proofLink?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  recordedBy?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  submittedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  voidReason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
}>;

export type PaymentPageResolvers<ContextType = any, ParentType extends ResolversParentTypes['PaymentPage'] = ResolversParentTypes['PaymentPage']> = ResolversObject<{
  items?: Resolver<Array<ResolversTypes['Payment']>, ParentType, ContextType>;
  nextCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
}>;

export type PaymentPayloadResolvers<ContextType = any, ParentType extends ResolversParentTypes['PaymentPayload'] = ResolversParentTypes['PaymentPayload']> = ResolversObject<{
  errors?: Resolver<Array<ResolversTypes['UserError']>, ParentType, ContextType>;
  member?: Resolver<Maybe<ResolversTypes['Member']>, ParentType, ContextType>;
  payment?: Resolver<Maybe<ResolversTypes['Payment']>, ParentType, ContextType>;
}>;

export type PaymentPreviewResolvers<ContextType = any, ParentType extends ResolversParentTypes['PaymentPreview'] = ResolversParentTypes['PaymentPreview']> = ResolversObject<{
  allocations?: Resolver<Array<ResolversTypes['Allocation']>, ParentType, ContextType>;
  creditAfter?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  paidThroughAfter?: Resolver<Maybe<ResolversTypes['Date']>, ParentType, ContextType>;
}>;

export type PlanResolvers<ContextType = any, ParentType extends ResolversParentTypes['Plan'] = ResolversParentTypes['Plan']> = ResolversObject<{
  admissionFee?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  key?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  monthlyFee?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
}>;

export type PlanPayloadResolvers<ContextType = any, ParentType extends ResolversParentTypes['PlanPayload'] = ResolversParentTypes['PlanPayload']> = ResolversObject<{
  errors?: Resolver<Array<ResolversTypes['UserError']>, ParentType, ContextType>;
  plan?: Resolver<Maybe<ResolversTypes['Plan']>, ParentType, ContextType>;
}>;

export type PublicTenantResolvers<ContextType = any, ParentType extends ResolversParentTypes['PublicTenant'] = ResolversParentTypes['PublicTenant']> = ResolversObject<{
  branding?: Resolver<ResolversTypes['Branding'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
}>;

export type QueryResolvers<ContextType = any, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = ResolversObject<{
  auditEvents?: Resolver<ResolversTypes['AuditEventPage'], ParentType, ContextType, Partial<QueryAuditEventsArgs>>;
  discounts?: Resolver<Array<ResolversTypes['Discount']>, ParentType, ContextType, RequireFields<QueryDiscountsArgs, 'memberId'>>;
  health?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  invoices?: Resolver<ResolversTypes['InvoicePage'], ParentType, ContextType, RequireFields<QueryInvoicesArgs, 'memberId'>>;
  me?: Resolver<ResolversTypes['Me'], ParentType, ContextType>;
  member?: Resolver<Maybe<ResolversTypes['Member']>, ParentType, ContextType, RequireFields<QueryMemberArgs, 'id'>>;
  members?: Resolver<ResolversTypes['MemberPage'], ParentType, ContextType, Partial<QueryMembersArgs>>;
  membershipPeriods?: Resolver<Array<ResolversTypes['MembershipPeriod']>, ParentType, ContextType, RequireFields<QueryMembershipPeriodsArgs, 'memberId'>>;
  myGyms?: Resolver<Array<ResolversTypes['Gym']>, ParentType, ContextType>;
  payments?: Resolver<ResolversTypes['PaymentPage'], ParentType, ContextType, RequireFields<QueryPaymentsArgs, 'memberId'>>;
  plans?: Resolver<Array<ResolversTypes['Plan']>, ParentType, ContextType>;
  previewPayment?: Resolver<ResolversTypes['PaymentPreview'], ParentType, ContextType, RequireFields<QueryPreviewPaymentArgs, 'amount' | 'memberId'>>;
  publicTenant?: Resolver<Maybe<ResolversTypes['PublicTenant']>, ParentType, ContextType, RequireFields<QueryPublicTenantArgs, 'subdomain'>>;
  staff?: Resolver<Array<ResolversTypes['StaffUser']>, ParentType, ContextType>;
  tenant?: Resolver<ResolversTypes['Tenant'], ParentType, ContextType>;
  visits?: Resolver<ResolversTypes['VisitPage'], ParentType, ContextType, RequireFields<QueryVisitsArgs, 'memberId'>>;
}>;

export type ScanPayloadResolvers<ContextType = any, ParentType extends ResolversParentTypes['ScanPayload'] = ResolversParentTypes['ScanPayload']> = ResolversObject<{
  errors?: Resolver<Array<ResolversTypes['UserError']>, ParentType, ContextType>;
  member?: Resolver<Maybe<ResolversTypes['Member']>, ParentType, ContextType>;
  visit?: Resolver<Maybe<ResolversTypes['Visit']>, ParentType, ContextType>;
}>;

export type SelectGymPayloadResolvers<ContextType = any, ParentType extends ResolversParentTypes['SelectGymPayload'] = ResolversParentTypes['SelectGymPayload']> = ResolversObject<{
  errors?: Resolver<Array<ResolversTypes['UserError']>, ParentType, ContextType>;
  me?: Resolver<Maybe<ResolversTypes['Me']>, ParentType, ContextType>;
  tenant?: Resolver<Maybe<ResolversTypes['Tenant']>, ParentType, ContextType>;
}>;

export type SignInPayloadResolvers<ContextType = any, ParentType extends ResolversParentTypes['SignInPayload'] = ResolversParentTypes['SignInPayload']> = ResolversObject<{
  errors?: Resolver<Array<ResolversTypes['UserError']>, ParentType, ContextType>;
  expiresAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  gyms?: Resolver<Array<ResolversTypes['Gym']>, ParentType, ContextType>;
  token?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
}>;

export type StaffPayloadResolvers<ContextType = any, ParentType extends ResolversParentTypes['StaffPayload'] = ResolversParentTypes['StaffPayload']> = ResolversObject<{
  errors?: Resolver<Array<ResolversTypes['UserError']>, ParentType, ContextType>;
  user?: Resolver<Maybe<ResolversTypes['StaffUser']>, ParentType, ContextType>;
}>;

export type StaffUserResolvers<ContextType = any, ParentType extends ResolversParentTypes['StaffUser'] = ResolversParentTypes['StaffUser']> = ResolversObject<{
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  hasSignedIn?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  name?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  roles?: Resolver<Array<ResolversTypes['Role']>, ParentType, ContextType>;
  userId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
}>;

export type TenantResolvers<ContextType = any, ParentType extends ResolversParentTypes['Tenant'] = ResolversParentTypes['Tenant']> = ResolversObject<{
  branding?: Resolver<ResolversTypes['Branding'], ParentType, ContextType>;
  currency?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  settings?: Resolver<ResolversTypes['TenantSettings'], ParentType, ContextType>;
  subdomain?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  timezone?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
}>;

export type TenantPayloadResolvers<ContextType = any, ParentType extends ResolversParentTypes['TenantPayload'] = ResolversParentTypes['TenantPayload']> = ResolversObject<{
  errors?: Resolver<Array<ResolversTypes['UserError']>, ParentType, ContextType>;
  tenant?: Resolver<Maybe<ResolversTypes['Tenant']>, ParentType, ContextType>;
}>;

export type TenantSettingsResolvers<ContextType = any, ParentType extends ResolversParentTypes['TenantSettings'] = ResolversParentTypes['TenantSettings']> = ResolversObject<{
  dupWindowMin?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  redDaysAfter?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  referredAmount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  referredIsRecurring?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  referrerAmount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  referrerIsRecurring?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  warnDaysBefore?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
}>;

export type UserErrorResolvers<ContextType = any, ParentType extends ResolversParentTypes['UserError'] = ResolversParentTypes['UserError']> = ResolversObject<{
  code?: Resolver<ResolversTypes['ErrorCode'], ParentType, ContextType>;
  field?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
}>;

export type VisitResolvers<ContextType = any, ParentType extends ResolversParentTypes['Visit'] = ResolversParentTypes['Visit']> = ResolversObject<{
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isDuplicate?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  localDate?: Resolver<ResolversTypes['Date'], ParentType, ContextType>;
  memberId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  scannedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  source?: Resolver<ResolversTypes['ScanSource'], ParentType, ContextType>;
  statusAtScan?: Resolver<ResolversTypes['Standing'], ParentType, ContextType>;
}>;

export type VisitPageResolvers<ContextType = any, ParentType extends ResolversParentTypes['VisitPage'] = ResolversParentTypes['VisitPage']> = ResolversObject<{
  items?: Resolver<Array<ResolversTypes['Visit']>, ParentType, ContextType>;
  nextCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
}>;

export type Resolvers<ContextType = any> = ResolversObject<{
  Allocation?: AllocationResolvers<ContextType>;
  AuditEvent?: AuditEventResolvers<ContextType>;
  AuditEventPage?: AuditEventPageResolvers<ContextType>;
  Branding?: BrandingResolvers<ContextType>;
  Date?: GraphQLScalarType;
  DateTime?: GraphQLScalarType;
  Discount?: DiscountResolvers<ContextType>;
  DiscountPayload?: DiscountPayloadResolvers<ContextType>;
  Gym?: GymResolvers<ContextType>;
  Invoice?: InvoiceResolvers<ContextType>;
  InvoiceLine?: InvoiceLineResolvers<ContextType>;
  InvoicePage?: InvoicePageResolvers<ContextType>;
  InvoicePayload?: InvoicePayloadResolvers<ContextType>;
  JSON?: GraphQLScalarType;
  Me?: MeResolvers<ContextType>;
  Member?: MemberResolvers<ContextType>;
  MemberPage?: MemberPageResolvers<ContextType>;
  MemberPayload?: MemberPayloadResolvers<ContextType>;
  MembershipPeriod?: MembershipPeriodResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  Payment?: PaymentResolvers<ContextType>;
  PaymentPage?: PaymentPageResolvers<ContextType>;
  PaymentPayload?: PaymentPayloadResolvers<ContextType>;
  PaymentPreview?: PaymentPreviewResolvers<ContextType>;
  Plan?: PlanResolvers<ContextType>;
  PlanPayload?: PlanPayloadResolvers<ContextType>;
  PublicTenant?: PublicTenantResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  ScanPayload?: ScanPayloadResolvers<ContextType>;
  SelectGymPayload?: SelectGymPayloadResolvers<ContextType>;
  SignInPayload?: SignInPayloadResolvers<ContextType>;
  StaffPayload?: StaffPayloadResolvers<ContextType>;
  StaffUser?: StaffUserResolvers<ContextType>;
  Tenant?: TenantResolvers<ContextType>;
  TenantPayload?: TenantPayloadResolvers<ContextType>;
  TenantSettings?: TenantSettingsResolvers<ContextType>;
  UserError?: UserErrorResolvers<ContextType>;
  Visit?: VisitResolvers<ContextType>;
  VisitPage?: VisitPageResolvers<ContextType>;
}>;

