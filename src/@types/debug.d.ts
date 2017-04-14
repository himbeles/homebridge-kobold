declare module 'debug' {
  interface Debugger {
    (formatter: any, ...args: any[]): void;
    extend(namespace: string, delimiter?: string): Debugger;
    enabled: boolean;
    log: (...args: any[]) => void;
    namespace: string;
  }

  function createDebugger(namespace: string): Debugger;
  export default createDebugger;
}
