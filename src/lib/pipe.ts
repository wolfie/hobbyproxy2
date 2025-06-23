/* eslint-disable @typescript-eslint/no-explicit-any */

function pipe<ARGS extends any[], T1, T2>(
  fn1: (...args: ARGS) => T1,
  fn2: (arg: NoInfer<T1>) => T2,
): (...args: ARGS) => NoInfer<T2>;
function pipe(...allFns: ((...args: any[]) => any)[]) {
  if (allFns.length < 1)
    throw new Error("Must pipe with at least one function");
  const [initFn, ...restFns] = allFns;
  return (...args: any[]) => {
    const value = initFn!(...args);
    return restFns.reduce((value, fn) => fn(value), value);
  };
}

export default pipe;
