import React, { createContext, useContext, useReducer, useMemo, type FC, type ReactNode } from 'react';
import type { NDJSONEvent } from '../../agent/types.js';

export interface SubagentProgress {
  agentName: string;
  state: 'running' | 'completed' | 'error' | 'cancelled';
  thought?: string;
  toolCall?: {
    name: string;
    args: Record<string, unknown>;
    status: 'running' | 'success' | 'error';
    output?: string;
  };
  result?: string;
}

export interface ActiveToolCall {
  id: string;
  agentName: string;
  toolName: string;
  args: Record<string, unknown>;
  status: 'running' | 'success' | 'error';
  startTime: number;
  durationMs?: number;
  output?: string;
}

export interface StreamingState {
  subagents: Record<string, SubagentProgress>;
  subagentOrder: string[];
  streamingThoughts: Record<string, string>;
  activeTools: ActiveToolCall[];
  isStreaming: boolean;
  streamError: string | null;
}

export interface StreamingActions {
  updateSubagentProgress: (progress: SubagentProgress) => void;
  appendSubagentProgress: (progress: SubagentProgress) => void;
  appendThought: (agentName: string, chunk: string) => void;
  setThought: (agentName: string, thought: string) => void;
  setStreamingThought: (thought: string) => void;
  startToolCall: (params: {
    agentName: string;
    toolName: string;
    args: Record<string, unknown>;
  }) => string;
  finishToolCall: (params: {
    toolName: string;
    status: 'success' | 'error';
    output?: string;
    durationMs?: number;
  }) => void;
  setActiveTool: (tool: ActiveToolCall | null) => void;
  clearStream: () => void;
  clearStreaming: () => void;
  setStreaming: (isStreaming: boolean) => void;
  setStreamError: (error: string | null) => void;
  processNDJSON: (event: NDJSONEvent) => void;
}

export interface StreamingContextValue {
  state: StreamingState;
  actions: StreamingActions;
  // Flat convenience accessors
  subagents: SubagentProgress[];
  subagentsMap: Record<string, SubagentProgress>;
  subagentOrder: string[];
  activeThought: string;
  streamingThoughts: Record<string, string>;
  activeTool: ActiveToolCall | null;
  activeTools: ActiveToolCall[];
  isStreaming: boolean;
  streamError: string | null;
  updateSubagentProgress: (progress: SubagentProgress) => void;
  appendSubagentProgress: (progress: SubagentProgress) => void;
  appendThought: (agentName: string, chunk: string) => void;
  setThought: (agentName: string, thought: string) => void;
  setStreamingThought: (thought: string) => void;
  startToolCall: (params: {
    agentName: string;
    toolName: string;
    args: Record<string, unknown>;
  }) => string;
  finishToolCall: (params: {
    toolName: string;
    status: 'success' | 'error';
    output?: string;
    durationMs?: number;
  }) => void;
  setActiveTool: (tool: ActiveToolCall | null) => void;
  clearStream: () => void;
  clearStreaming: () => void;
  setStreaming: (isStreaming: boolean) => void;
  setStreamError: (error: string | null) => void;
  processNDJSON: (event: NDJSONEvent) => void;
}

type StreamingAction =
  | { type: 'UPDATE_SUBAGENT_PROGRESS'; payload: SubagentProgress }
  | { type: 'APPEND_THOUGHT'; payload: { agentName: string; chunk: string } }
  | { type: 'SET_THOUGHT'; payload: { agentName: string; thought: string } }
  | { type: 'SET_GLOBAL_THOUGHT'; payload: string }
  | { type: 'START_TOOL_CALL'; payload: ActiveToolCall }
  | {
      type: 'FINISH_TOOL_CALL';
      payload: { toolName: string; status: 'success' | 'error'; output?: string; durationMs?: number };
    }
  | { type: 'SET_ACTIVE_TOOL'; payload: ActiveToolCall | null }
  | { type: 'CLEAR_STREAM' }
  | { type: 'SET_STREAMING'; payload: boolean }
  | { type: 'SET_STREAM_ERROR'; payload: string | null };

const initialStreamingState: StreamingState = {
  subagents: {},
  subagentOrder: [],
  streamingThoughts: {},
  activeTools: [],
  isStreaming: false,
  streamError: null,
};

function streamingReducer(state: StreamingState, action: StreamingAction): StreamingState {
  switch (action.type) {
    case 'UPDATE_SUBAGENT_PROGRESS': {
      const p = action.payload;
      const order = state.subagentOrder.includes(p.agentName)
        ? state.subagentOrder
        : [...state.subagentOrder, p.agentName];

      const currentThoughts = state.streamingThoughts[p.agentName] || '';
      const updatedThoughts = p.thought !== undefined ? p.thought : currentThoughts;

      return {
        ...state,
        subagents: {
          ...state.subagents,
          [p.agentName]: {
            ...state.subagents[p.agentName],
            ...p,
          },
        },
        subagentOrder: order,
        streamingThoughts: {
          ...state.streamingThoughts,
          [p.agentName]: updatedThoughts,
        },
        isStreaming: p.state === 'running' ? true : state.isStreaming,
      };
    }

    case 'APPEND_THOUGHT': {
      const { agentName, chunk } = action.payload;
      const existing = state.streamingThoughts[agentName] || '';
      return {
        ...state,
        streamingThoughts: {
          ...state.streamingThoughts,
          [agentName]: existing + chunk,
        },
      };
    }

    case 'SET_THOUGHT': {
      const { agentName, thought } = action.payload;
      return {
        ...state,
        streamingThoughts: {
          ...state.streamingThoughts,
          [agentName]: thought,
        },
      };
    }

    case 'SET_GLOBAL_THOUGHT': {
      return {
        ...state,
        streamingThoughts: {
          ...state.streamingThoughts,
          _global: action.payload,
        },
      };
    }

    case 'START_TOOL_CALL':
      return {
        ...state,
        activeTools: [
          ...state.activeTools.filter((t) => t.toolName !== action.payload.toolName),
          action.payload,
        ],
      };

    case 'FINISH_TOOL_CALL': {
      const { toolName, status, output, durationMs } = action.payload;
      return {
        ...state,
        activeTools: state.activeTools.map((t) =>
          t.toolName === toolName
            ? {
                ...t,
                status,
                output,
                durationMs: durationMs ?? (Date.now() - t.startTime),
              }
            : t
        ),
      };
    }

    case 'SET_ACTIVE_TOOL': {
      if (!action.payload) {
        return { ...state, activeTools: [] };
      }
      return {
        ...state,
        activeTools: [
          ...state.activeTools.filter((t) => t.id !== action.payload?.id),
          action.payload,
        ],
      };
    }

    case 'CLEAR_STREAM':
      return initialStreamingState;

    case 'SET_STREAMING':
      return { ...state, isStreaming: action.payload };

    case 'SET_STREAM_ERROR':
      return { ...state, streamError: action.payload, isStreaming: false };

    default:
      return state;
  }
}

export const StreamingContext = createContext<StreamingContextValue | null>(null);

export interface StreamingProviderProps {
  children: ReactNode;
  initialState?: Partial<StreamingState>;
}

export const StreamingProvider: FC<StreamingProviderProps> = ({ children, initialState }) => {
  const [state, dispatch] = useReducer(streamingReducer, {
    ...initialStreamingState,
    ...initialState,
  });

  const actions = useMemo<StreamingActions>(() => {
    return {
      updateSubagentProgress: (progress) =>
        dispatch({ type: 'UPDATE_SUBAGENT_PROGRESS', payload: progress }),
      appendSubagentProgress: (progress) =>
        dispatch({ type: 'UPDATE_SUBAGENT_PROGRESS', payload: progress }),
      appendThought: (agentName, chunk) =>
        dispatch({ type: 'APPEND_THOUGHT', payload: { agentName, chunk } }),
      setThought: (agentName, thought) =>
        dispatch({ type: 'SET_THOUGHT', payload: { agentName, thought } }),
      setStreamingThought: (thought) =>
        dispatch({ type: 'SET_GLOBAL_THOUGHT', payload: thought }),
      startToolCall: ({ agentName, toolName, args }) => {
        const id = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        dispatch({
          type: 'START_TOOL_CALL',
          payload: {
            id,
            agentName,
            toolName,
            args,
            status: 'running',
            startTime: Date.now(),
          },
        });
        return id;
      },
      finishToolCall: (payload) => dispatch({ type: 'FINISH_TOOL_CALL', payload }),
      setActiveTool: (tool) => dispatch({ type: 'SET_ACTIVE_TOOL', payload: tool }),
      clearStream: () => dispatch({ type: 'CLEAR_STREAM' }),
      clearStreaming: () => dispatch({ type: 'CLEAR_STREAM' }),
      setStreaming: (isStreaming) => dispatch({ type: 'SET_STREAMING', payload: isStreaming }),
      setStreamError: (error) => dispatch({ type: 'SET_STREAM_ERROR', payload: error }),
      processNDJSON: (event: NDJSONEvent) => {
        if (!event || typeof event !== 'object' || !('event' in event)) return;

        switch (event.event) {
          case 'agent_start':
            dispatch({
              type: 'UPDATE_SUBAGENT_PROGRESS',
              payload: { agentName: event.role, state: 'running', thought: event.message },
            });
            break;
          case 'agent_tool_call':
            dispatch({
              type: 'START_TOOL_CALL',
              payload: {
                id: `ndjson-${Date.now()}`,
                agentName: event.role,
                toolName: event.tool,
                args: event.args,
                status: 'running',
                startTime: Date.now(),
              },
            });
            dispatch({
              type: 'UPDATE_SUBAGENT_PROGRESS',
              payload: {
                agentName: event.role,
                state: 'running',
                toolCall: { name: event.tool, args: event.args, status: 'running' },
              },
            });
            break;
          case 'agent_tool_result':
            dispatch({
              type: 'FINISH_TOOL_CALL',
              payload: {
                toolName: event.tool,
                status: 'success',
                durationMs: event.durationMs,
                output: `completed in ${event.durationMs}ms`,
              },
            });
            dispatch({
              type: 'UPDATE_SUBAGENT_PROGRESS',
              payload: {
                agentName: event.role,
                state: 'running',
                toolCall: {
                  name: event.tool,
                  args: {},
                  status: 'success',
                  output: `completed in ${event.durationMs}ms`,
                },
              },
            });
            break;
          case 'agent_progress':
            dispatch({
              type: 'UPDATE_SUBAGENT_PROGRESS',
              payload: { agentName: event.role, state: 'running', thought: event.message },
            });
            break;
          case 'agent_complete':
            dispatch({
              type: 'UPDATE_SUBAGENT_PROGRESS',
              payload: { agentName: event.role, state: 'completed', result: event.summary },
            });
            break;
          case 'agent_failed':
            dispatch({
              type: 'UPDATE_SUBAGENT_PROGRESS',
              payload: { agentName: event.role, state: 'error', result: event.error },
            });
            break;
          case 'diagnosis_ready':
            dispatch({
              type: 'UPDATE_SUBAGENT_PROGRESS',
              payload: {
                agentName: 'SynthesizerAgent',
                state: 'completed',
                result: event.consensus.rootCause,
              },
            });
            break;
        }
      },
    };
  }, []);

  const contextValue = useMemo<StreamingContextValue>(() => {
    const subagentsList: SubagentProgress[] = state.subagentOrder.map(
      (name) => state.subagents[name]
    );
    const activeThought =
      state.streamingThoughts._global ||
      (state.subagentOrder.length > 0
        ? state.streamingThoughts[state.subagentOrder[state.subagentOrder.length - 1]] || ''
        : '');
    const activeTool = state.activeTools.length > 0 ? state.activeTools[state.activeTools.length - 1] : null;

    return {
      state,
      actions,
      subagents: subagentsList,
      subagentsMap: state.subagents,
      subagentOrder: state.subagentOrder,
      activeThought,
      streamingThoughts: state.streamingThoughts,
      activeTool,
      activeTools: state.activeTools,
      isStreaming: state.isStreaming,
      streamError: state.streamError,
      updateSubagentProgress: actions.updateSubagentProgress,
      appendSubagentProgress: actions.appendSubagentProgress,
      appendThought: actions.appendThought,
      setThought: actions.setThought,
      setStreamingThought: actions.setStreamingThought,
      startToolCall: actions.startToolCall,
      finishToolCall: actions.finishToolCall,
      setActiveTool: actions.setActiveTool,
      clearStream: actions.clearStream,
      clearStreaming: actions.clearStreaming,
      setStreaming: actions.setStreaming,
      setStreamError: actions.setStreamError,
      processNDJSON: actions.processNDJSON,
    };
  }, [state, actions]);

  return <StreamingContext.Provider value={contextValue}>{children}</StreamingContext.Provider>;
};

export function useStreaming(): StreamingContextValue {
  const ctx = useContext(StreamingContext);
  if (!ctx) {
    throw new Error('useStreaming must be used within a StreamingProvider');
  }
  return ctx;
}
