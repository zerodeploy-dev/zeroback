import type { PropertyValidators, ObjectType, Validator } from "@vex/values";
import type { QueryCtx, MutationCtx, ActionCtx, RegisteredQuery, RegisteredMutation, RegisteredAction } from "./types.js";

function makeQueryFactory<DataModel>(isInternal: boolean) {
  return function <Args extends PropertyValidators, Returns>(config: {
    args: Args;
    returns?: Validator<Returns>;
    handler: (ctx: QueryCtx<DataModel>, args: ObjectType<Args>) => Promise<Returns>;
  }): RegisteredQuery<ObjectType<Args>, Returns> & { handler: (ctx: QueryCtx<DataModel>, args: ObjectType<Args>) => Promise<Returns>; _argsValidator: Args; _returnsValidator?: Validator<Returns> } {
    return {
      _name: "anonymous",
      _type: "query",
      _isInternal: isInternal,
      _args: undefined as unknown as ObjectType<Args>,
      _returns: undefined as unknown as Returns,
      _argsValidator: config.args,
      _returnsValidator: config.returns,
      handler: config.handler,
    } as any;
  };
}

function makeMutationFactory<DataModel>(isInternal: boolean) {
  return function <Args extends PropertyValidators, Returns>(config: {
    args: Args;
    returns?: Validator<Returns>;
    handler: (ctx: MutationCtx<DataModel>, args: ObjectType<Args>) => Promise<Returns>;
  }): RegisteredMutation<ObjectType<Args>, Returns> & { handler: (ctx: MutationCtx<DataModel>, args: ObjectType<Args>) => Promise<Returns>; _argsValidator: Args; _returnsValidator?: Validator<Returns> } {
    return {
      _name: "anonymous",
      _type: "mutation",
      _isInternal: isInternal,
      _args: undefined as unknown as ObjectType<Args>,
      _returns: undefined as unknown as Returns,
      _argsValidator: config.args,
      _returnsValidator: config.returns,
      handler: config.handler,
    } as any;
  };
}

function makeActionFactory<DataModel>(isInternal: boolean) {
  return function <Args extends PropertyValidators, Returns>(config: {
    args: Args;
    returns?: Validator<Returns>;
    handler: (ctx: ActionCtx<DataModel>, args: ObjectType<Args>) => Promise<Returns>;
  }): RegisteredAction<ObjectType<Args>, Returns> & { handler: (ctx: ActionCtx<DataModel>, args: ObjectType<Args>) => Promise<Returns>; _argsValidator: Args; _returnsValidator?: Validator<Returns> } {
    return {
      _name: "anonymous",
      _type: "action",
      _isInternal: isInternal,
      _args: undefined as unknown as ObjectType<Args>,
      _returns: undefined as unknown as Returns,
      _argsValidator: config.args,
      _returnsValidator: config.returns,
      handler: config.handler,
    } as any;
  };
}

export function createQueryFactory<DataModel>() {
  return makeQueryFactory<DataModel>(false);
}

export function createMutationFactory<DataModel>() {
  return makeMutationFactory<DataModel>(false);
}

export function createActionFactory<DataModel>() {
  return makeActionFactory<DataModel>(false);
}

export function createInternalQueryFactory<DataModel>() {
  return makeQueryFactory<DataModel>(true);
}

export function createInternalMutationFactory<DataModel>() {
  return makeMutationFactory<DataModel>(true);
}

export function createInternalActionFactory<DataModel>() {
  return makeActionFactory<DataModel>(true);
}
