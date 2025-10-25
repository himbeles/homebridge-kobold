declare module 'debug' {
  type DebugLogArgs = ReadonlyArray<unknown>;

  interface Debugger {
    (formatter: unknown, ...args: DebugLogArgs): void;
    extend(namespace: string, delimiter?: string): Debugger;
    enabled: boolean;
    log: (...args: DebugLogArgs) => void;
    namespace: string;
  }

  function createDebugger(namespace: string): Debugger;
  export default createDebugger;
}
