import { describe, expect, it } from "vitest";
import { antigravity, agy, type AgentCommandOptions } from "./AgentProvider.js";

const opts = (prompt: string): AgentCommandOptions => ({
  prompt,
  dangerouslySkipPermissions: true,
});

describe("antigravity factory", () => {
  it("returns a provider with name 'antigravity'", () => {
    const provider = antigravity("gemini-3.8-flash-high");
    expect(provider.name).toBe("antigravity");
  });

  it("agy is an alias for antigravity", () => {
    expect(agy).toBe(antigravity);
    const provider = agy();
    expect(provider.name).toBe("antigravity");
  });

  it("defaults to gemini-3.8-flash-high when model is omitted", () => {
    const provider = antigravity();
    const cmd = provider.buildPrintCommand(opts("Hello"));
    expect(cmd.command).toContain("--model 'gemini-3.8-flash-high'");
  });

  it("buildPrintCommand passes prompt via stdin", () => {
    const provider = antigravity("gemini-3.7-flash-high");
    const cmd = provider.buildPrintCommand(opts("Write a test"));
    expect(cmd.stdin).toBe("Write a test");
    expect(cmd.command).toContain(
      "agy --output-format stream-json --model 'gemini-3.7-flash-high'",
    );
  });

  it("buildPrintCommand includes --dangerously-skip-permissions when requested", () => {
    const provider = antigravity();
    const cmdAllowed = provider.buildPrintCommand({
      prompt: "test",
      dangerouslySkipPermissions: true,
    });
    expect(cmdAllowed.command).toContain("--dangerously-skip-permissions");

    const cmdDenied = provider.buildPrintCommand({
      prompt: "test",
      dangerouslySkipPermissions: false,
    });
    expect(cmdDenied.command).not.toContain("--dangerously-skip-permissions");
  });

  it("buildPrintCommand includes effort when specified", () => {
    const provider = antigravity("gemini-3.8-flash-high", { effort: "high" });
    const cmd = provider.buildPrintCommand(opts("test"));
    expect(cmd.command).toContain("--effort high");
  });

  it("buildPrintCommand includes mode when specified", () => {
    const provider = antigravity("gemini-3.8-flash-high", {
      mode: "accept-edits",
    });
    const cmd = provider.buildPrintCommand(opts("test"));
    expect(cmd.command).toContain("--mode accept-edits");
  });

  it("buildPrintCommand includes --conversation when resumeSession is provided", () => {
    const provider = antigravity();
    const cmd = provider.buildPrintCommand({
      prompt: "continue task",
      dangerouslySkipPermissions: true,
      resumeSession: "conv-uuid-12345",
    });
    expect(cmd.command).toContain("--conversation 'conv-uuid-12345'");
  });

  it("buildInteractiveArgs constructs interactive agy command", () => {
    const provider = antigravity("gemini-3.8-flash-high", {
      effort: "medium",
      mode: "plan",
    });
    const args = provider.buildInteractiveArgs!(opts("interactive prompt"));
    expect(args).toEqual([
      "agy",
      "--model",
      "gemini-3.8-flash-high",
      "--effort",
      "medium",
      "--mode",
      "plan",
      "-i",
      "interactive prompt",
    ]);
  });
});

describe("parseAntigravityStreamLine", () => {
  const provider = antigravity();

  it("ignores non-JSON lines", () => {
    expect(provider.parseStreamLine("plain text line")).toEqual([]);
    expect(provider.parseStreamLine("")).toEqual([]);
    expect(provider.parseStreamLine("{broken json")).toEqual([]);
  });

  it("parses init event to session_id", () => {
    const line = JSON.stringify({
      event: "init",
      conversation_id: "8c1a6bb1-1234-5678-9abc-def012345678",
      init: { model: "gemini-3.8-flash-high" },
    });
    expect(provider.parseStreamLine(line)).toEqual([
      {
        type: "session_id",
        sessionId: "8c1a6bb1-1234-5678-9abc-def012345678",
      },
    ]);
  });

  it("parses agent_response text delta", () => {
    const line = JSON.stringify({
      event: "step_update",
      step_update: {
        step_type: "agent_response",
        state: "ACTIVE",
        text_delta: "Hello, world!",
      },
    });
    expect(provider.parseStreamLine(line)).toEqual([
      { type: "text", text: "Hello, world!" },
    ]);
  });

  it("parses run_command tool call as Bash", () => {
    const line = JSON.stringify({
      event: "step_update",
      step_update: {
        step_type: "tool",
        state: "ACTIVE",
        tool_name: "run_command",
        tool_info: {
          name: "run_command",
          parameters: { CommandLine: "npm test" },
        },
      },
    });
    expect(provider.parseStreamLine(line)).toEqual([
      { type: "tool_call", name: "Bash", args: "npm test" },
    ]);
  });

  it("parses view_file tool call as Read", () => {
    const line = JSON.stringify({
      event: "step_update",
      step_update: {
        step_type: "tool",
        state: "ACTIVE",
        tool_name: "view_file",
        tool_info: {
          name: "view_file",
          parameters: { AbsolutePath: "/path/to/file.ts" },
        },
      },
    });
    expect(provider.parseStreamLine(line)).toEqual([
      { type: "tool_call", name: "Read", args: "/path/to/file.ts" },
    ]);
  });

  it("parses edit_file and write_to_file tool calls", () => {
    const editLine = JSON.stringify({
      event: "step_update",
      step_update: {
        step_type: "tool",
        state: "ACTIVE",
        tool_name: "replace_file_content",
        tool_info: {
          parameters: { TargetFile: "src/index.ts" },
        },
      },
    });
    expect(provider.parseStreamLine(editLine)).toEqual([
      { type: "tool_call", name: "Edit", args: "src/index.ts" },
    ]);

    const writeLine = JSON.stringify({
      event: "step_update",
      step_update: {
        step_type: "tool",
        state: "ACTIVE",
        tool_name: "write_to_file",
        tool_info: {
          parameters: { TargetFile: "src/new.ts" },
        },
      },
    });
    expect(provider.parseStreamLine(writeLine)).toEqual([
      { type: "tool_call", name: "Write", args: "src/new.ts" },
    ]);
  });

  it("ignores completed tool steps (state DONE)", () => {
    const line = JSON.stringify({
      event: "step_update",
      step_update: {
        step_type: "tool",
        state: "DONE",
        tool_name: "run_command",
        duration_seconds: 0.1,
      },
    });
    expect(provider.parseStreamLine(line)).toEqual([]);
  });

  it("parses result event with text and token usage", () => {
    const line = JSON.stringify({
      event: "result",
      result: {
        status: "SUCCESS",
        response: "All tasks completed.",
        usage: {
          input_tokens: 12000,
          output_tokens: 500,
          thinking_tokens: 150,
          cache_read_tokens: 8000,
          total_tokens: 12650,
        },
      },
    });
    expect(provider.parseStreamLine(line)).toEqual([
      { type: "result", result: "All tasks completed." },
      {
        type: "usage",
        usage: {
          inputTokens: 4000, // 12000 - 8000 cached
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 8000,
          outputTokens: 650, // 500 + 150 thinking
        },
      },
    ]);
  });

  it("parses error events into result message", () => {
    const errorLine = JSON.stringify({
      event: "error",
      error: "Authentication expired",
    });
    expect(provider.parseStreamLine(errorLine)).toEqual([
      { type: "result", result: "Authentication expired" },
    ]);
  });
});

describe("parseAntigravitySessionUsage", () => {
  const provider = antigravity();

  it("extracts usage from multiline session content", () => {
    const content = [
      JSON.stringify({ event: "init", conversation_id: "123" }),
      JSON.stringify({
        event: "step_update",
        step_update: { step_type: "agent_response", text_delta: "Hi" },
      }),
      JSON.stringify({
        event: "result",
        result: {
          status: "SUCCESS",
          response: "Done",
          usage: {
            input_tokens: 10000,
            cache_read_tokens: 6000,
            output_tokens: 300,
            thinking_tokens: 50,
          },
        },
      }),
    ].join("\n");

    const usage = provider.parseSessionUsage!(content);
    expect(usage).toEqual({
      inputTokens: 4000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 6000,
      outputTokens: 350,
    });
  });
});
