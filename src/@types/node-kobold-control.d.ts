declare module 'node-kobold-control' {
  class Robot {
    [key: string]: any;
  }

  class Client {
    constructor();
    authorize(token: string, callback: (error?: unknown) => void): void;
    getRobots(callback: (error: unknown, robots: Robot[]) => void): void;
  }

  const control: {
    Client: typeof Client;
  };

  export default control;
}
