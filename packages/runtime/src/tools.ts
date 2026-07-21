import { z } from "zod";

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  execute: (args: unknown) => Promise<unknown>;
};

export class RunSuspended extends Error {
  constructor(public readonly approvalId: string) {
    super("run suspended for approval");
  }
}
