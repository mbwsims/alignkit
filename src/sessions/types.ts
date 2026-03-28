export type AgentAction =
  | { type: 'bash'; command: string; exitCode?: number; timestamp: string }
  | { type: 'write'; filePath: string; content: string; timestamp: string }
  | { type: 'edit'; filePath: string; oldContent: string; newContent: string; timestamp: string }
  | { type: 'read'; filePath: string; timestamp: string };

export interface SessionInfo {
  sessionId: string;
  projectPath: string;
  created: string;
  modified: string;
  jsonlPath: string;
}
