import type { PropertyValidators, ObjectType, Validator } from "@zeroback/values";
import type { QueryCtx, MutationCtx, ActionCtx, RegisteredQuery, RegisteredMutation, RegisteredAction } from "./types.js";

type FunctionType = "query" | "mutation" | "action";

function makeFunctionFactory<DataModel>(type: FunctionType, isInternal: boolean) {
  return function <Args extends PropertyValidators, Returns>(config: {
    args: Args;
    returns?: Validator<Returns>;
    handler: (ctx: unknown, args: ObjectType<Args>) => Promise<Returns>;
  }) {
    return {
      _name: "anonymous",
      _type: type,
      _isInternal: isInternal,
      _args: undefined as unknown as ObjectType<Args>,
      _returns: undefined as unknown as Returns,
      _argsValidator: config.args,
      _returnsValidator: config.returns,
      handler: config.handler,
    } as unknown;
  };
}

export function createQueryFactory<DataModel>() {
  return makeFunctionFactory<DataModel>("query", false) as <Args extends PropertyValidators, Returns>(config: {
    args: Args;
    returns?: Validator<Returns>;
    handler: (ctx: QueryCtx<DataModel>, args: ObjectType<Args>) => Promise<Returns>;
  }) => RegisteredQuery<ObjectType<Args>, Returns> & { handler: (ctx: QueryCtx<DataModel>, args: ObjectType<Args>) => Promise<Returns>; _argsValidator: Args; _returnsValidator?: Validator<Returns> };
}

export function createMutationFactory<DataModel>() {
  return makeFunctionFactory<DataModel>("mutation", false) as <Args extends PropertyValidators, Returns>(config: {
    args: Args;
    returns?: Validator<Returns>;
    handler: (ctx: MutationCtx<DataModel>, args: ObjectType<Args>) => Promise<Returns>;
  }) => RegisteredMutation<ObjectType<Args>, Returns> & { handler: (ctx: MutationCtx<DataModel>, args: ObjectType<Args>) => Promise<Returns>; _argsValidator: Args; _returnsValidator?: Validator<Returns> };
}

export function createActionFactory<DataModel>() {
  return makeFunctionFactory<DataModel>("action", false) as <Args extends PropertyValidators, Returns>(config: {
    args: Args;
    returns?: Validator<Returns>;
    handler: (ctx: ActionCtx<DataModel>, args: ObjectType<Args>) => Promise<Returns>;
  }) => RegisteredAction<ObjectType<Args>, Returns> & { handler: (ctx: ActionCtx<DataModel>, args: ObjectType<Args>) => Promise<Returns>; _argsValidator: Args; _returnsValidator?: Validator<Returns> };
}

export function createInternalQueryFactory<DataModel>() {
  return makeFunctionFactory<DataModel>("query", true) as ReturnType<typeof createQueryFactory<DataModel>>;
}

export function createInternalMutationFactory<DataModel>() {
  return makeFunctionFactory<DataModel>("mutation", true) as ReturnType<typeof createMutationFactory<DataModel>>;
}

export function createInternalActionFactory<DataModel>() {
  return makeFunctionFactory<DataModel>("action", true) as ReturnType<typeof createActionFactory<DataModel>>;
}
