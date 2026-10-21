export interface RuntimeChildProcess {
  stdin?: NodeJS.WritableStream | null;
  stdout: NodeJS.ReadWriteStream;
  stderr: NodeJS.ReadWriteStream;
  kill(signal?: NodeJS.Signals): void;
  once(event: "error", listener: (error: Error) => void): this;
  once(
    event: "close",
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void
  ): this;
}
