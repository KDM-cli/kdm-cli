import React, { createContext, useContext, useReducer, useMemo, type FC, type ReactNode } from 'react';

export type ActiveDialog = 'none' | 'confirmation' | 'help' | 'settings' | 'dialog';

export type FocusedComponent =
  | 'composer'
  | 'confirmationQueue'
  | 'subagentProgress'
  | 'dashboard'
  | 'dialog';

export interface ConfirmationRequest {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  diff?: string;
  riskLevel: 'low' | 'medium' | 'high';
  prompt: string;
  timestamp?: number;
}

export type ConfirmationDecision = 'ALLOW' | 'DENY' | 'EDIT';

export interface UIState {
  activeDialog: ActiveDialog;
  confirmationQueue: ConfirmationRequest[];
  expandedCards: Record<string, boolean>;
  focusedComponent: FocusedComponent;
  activeTab: number;
  terminalDimensions: {
    columns: number;
    rows: number;
  };
}

export interface UIStateActions {
  setActiveDialog: (dialog: ActiveDialog) => void;
  closeDialog: () => void;
  enqueueConfirmation: (request: ConfirmationRequest) => void;
  resolveConfirmation: (id: string, decision: ConfirmationDecision) => void;
  toggleCardExpansion: (cardId: string) => void;
  setCardExpanded: (cardId: string, expanded: boolean) => void;
  expandAllCards: () => void;
  collapseAllCards: () => void;
  setFocusedComponent: (component: FocusedComponent) => void;
  setActiveTab: (tab: number) => void;
  setTerminalDimensions: (dims: { columns: number; rows: number }) => void;
  openConfirmation: (req: ConfirmationRequest) => void;
  closeConfirmation: () => void;
  toggleHelp: () => void;
}

export interface UIStateContextValue {
  state: UIState;
  actions: UIStateActions;
  // Flat convenience accessors
  activeDialog: ActiveDialog;
  confirmationQueue: ConfirmationRequest[];
  expandedCards: Record<string, boolean>;
  focusedComponent: FocusedComponent;
  activeTab: number;
  terminalDimensions: { columns: number; rows: number };
  activeConfirmation: ConfirmationRequest | null;
  isHelpOpen: boolean;
  setActiveDialog: (dialog: ActiveDialog) => void;
  closeDialog: () => void;
  enqueueConfirmation: (request: ConfirmationRequest) => void;
  resolveConfirmation: (id: string, decision: ConfirmationDecision) => void;
  toggleCardExpansion: (cardId: string) => void;
  setCardExpanded: (cardId: string, expanded: boolean) => void;
  expandAllCards: () => void;
  collapseAllCards: () => void;
  setFocusedComponent: (component: FocusedComponent) => void;
  setActiveTab: (tab: number) => void;
  setTerminalDimensions: (dims: { columns: number; rows: number }) => void;
  openConfirmation: (req: ConfirmationRequest) => void;
  closeConfirmation: () => void;
  toggleHelp: () => void;
}

type UIStateAction =
  | { type: 'SET_ACTIVE_DIALOG'; payload: ActiveDialog }
  | { type: 'CLOSE_DIALOG' }
  | { type: 'ENQUEUE_CONFIRMATION'; payload: ConfirmationRequest }
  | { type: 'RESOLVE_CONFIRMATION'; payload: { id: string; decision: ConfirmationDecision } }
  | { type: 'TOGGLE_CARD_EXPANSION'; payload: string }
  | { type: 'SET_CARD_EXPANDED'; payload: { cardId: string; expanded: boolean } }
  | { type: 'EXPAND_ALL_CARDS' }
  | { type: 'COLLAPSE_ALL_CARDS' }
  | { type: 'SET_FOCUSED_COMPONENT'; payload: FocusedComponent }
  | { type: 'SET_ACTIVE_TAB'; payload: number }
  | { type: 'SET_TERMINAL_DIMENSIONS'; payload: { columns: number; rows: number } };

const initialUIState: UIState = {
  activeDialog: 'none',
  confirmationQueue: [],
  expandedCards: {},
  focusedComponent: 'composer',
  activeTab: 1,
  terminalDimensions: {
    columns: typeof process !== 'undefined' && process.stdout?.columns ? process.stdout.columns : 120,
    rows: typeof process !== 'undefined' && process.stdout?.rows ? process.stdout.rows : 40,
  },
};

function uiStateReducer(state: UIState, action: UIStateAction): UIState {
  switch (action.type) {
    case 'SET_ACTIVE_DIALOG':
      return {
        ...state,
        activeDialog: action.payload,
        focusedComponent: action.payload === 'none' ? 'composer' : 'dialog',
      };

    case 'CLOSE_DIALOG':
      return {
        ...state,
        activeDialog: 'none',
        focusedComponent: state.confirmationQueue.length > 0 ? 'confirmationQueue' : 'composer',
      };

    case 'ENQUEUE_CONFIRMATION': {
      const exists = state.confirmationQueue.some((r) => r.id === action.payload.id);
      const queue = exists ? state.confirmationQueue : [...state.confirmationQueue, action.payload];
      return {
        ...state,
        confirmationQueue: queue,
        activeDialog: 'confirmation',
        focusedComponent: 'confirmationQueue',
      };
    }

    case 'RESOLVE_CONFIRMATION': {
      const remaining = state.confirmationQueue.filter((r) => r.id !== action.payload.id);
      const stillHasPending = remaining.length > 0;
      return {
        ...state,
        confirmationQueue: remaining,
        activeDialog: stillHasPending ? 'confirmation' : 'none',
        focusedComponent: stillHasPending ? 'confirmationQueue' : 'composer',
      };
    }

    case 'TOGGLE_CARD_EXPANSION':
      return {
        ...state,
        expandedCards: {
          ...state.expandedCards,
          [action.payload]: !state.expandedCards[action.payload],
        },
      };

    case 'SET_CARD_EXPANDED':
      return {
        ...state,
        expandedCards: {
          ...state.expandedCards,
          [action.payload.cardId]: action.payload.expanded,
        },
      };

    case 'EXPAND_ALL_CARDS': {
      const next: Record<string, boolean> = {};
      for (const key of Object.keys(state.expandedCards)) {
        next[key] = true;
      }
      return { ...state, expandedCards: next };
    }

    case 'COLLAPSE_ALL_CARDS':
      return { ...state, expandedCards: {} };

    case 'SET_FOCUSED_COMPONENT':
      return { ...state, focusedComponent: action.payload };

    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.payload };

    case 'SET_TERMINAL_DIMENSIONS':
      return { ...state, terminalDimensions: action.payload };

    default:
      return state;
  }
}

export const UIStateContext = createContext<UIStateContextValue | null>(null);

export interface UIStateProviderProps {
  children: ReactNode;
  initialState?: Partial<UIState>;
  onDecision?: (id: string, decision: ConfirmationDecision) => void;
}

export const UIStateProvider: FC<UIStateProviderProps> = ({
  children,
  initialState,
  onDecision,
}) => {
  const [state, dispatch] = useReducer(uiStateReducer, {
    ...initialUIState,
    ...initialState,
  });

  const actions = useMemo<UIStateActions>(
    () => ({
      setActiveDialog: (dialog) => dispatch({ type: 'SET_ACTIVE_DIALOG', payload: dialog }),
      closeDialog: () => dispatch({ type: 'CLOSE_DIALOG' }),
      enqueueConfirmation: (request) => dispatch({ type: 'ENQUEUE_CONFIRMATION', payload: request }),
      resolveConfirmation: (id, decision) => {
        onDecision?.(id, decision);
        dispatch({ type: 'RESOLVE_CONFIRMATION', payload: { id, decision } });
      },
      toggleCardExpansion: (cardId) => dispatch({ type: 'TOGGLE_CARD_EXPANSION', payload: cardId }),
      setCardExpanded: (cardId, expanded) =>
        dispatch({ type: 'SET_CARD_EXPANDED', payload: { cardId, expanded } }),
      expandAllCards: () => dispatch({ type: 'EXPAND_ALL_CARDS' }),
      collapseAllCards: () => dispatch({ type: 'COLLAPSE_ALL_CARDS' }),
      setFocusedComponent: (component) =>
        dispatch({ type: 'SET_FOCUSED_COMPONENT', payload: component }),
      setActiveTab: (tab) => dispatch({ type: 'SET_ACTIVE_TAB', payload: tab }),
      setTerminalDimensions: (dims) =>
        dispatch({ type: 'SET_TERMINAL_DIMENSIONS', payload: dims }),
      openConfirmation: (req) => dispatch({ type: 'ENQUEUE_CONFIRMATION', payload: req }),
      closeConfirmation: () => {
        if (state.confirmationQueue.length > 0) {
          const current = state.confirmationQueue[0];
          onDecision?.(current.id, 'DENY');
          dispatch({
            type: 'RESOLVE_CONFIRMATION',
            payload: { id: current.id, decision: 'DENY' },
          });
        } else {
          dispatch({ type: 'CLOSE_DIALOG' });
        }
      },
      toggleHelp: () =>
        dispatch({
          type: 'SET_ACTIVE_DIALOG',
          payload: state.activeDialog === 'help' ? 'none' : 'help',
        }),
    }),
    [onDecision, state.activeDialog, state.confirmationQueue]
  );

  const contextValue = useMemo<UIStateContextValue>(() => {
    const activeConfirmation = state.confirmationQueue.length > 0 ? state.confirmationQueue[0] : null;
    const isHelpOpen = state.activeDialog === 'help';

    return {
      state,
      actions,
      activeDialog: state.activeDialog,
      confirmationQueue: state.confirmationQueue,
      expandedCards: state.expandedCards,
      focusedComponent: state.focusedComponent,
      activeTab: state.activeTab,
      terminalDimensions: state.terminalDimensions,
      activeConfirmation,
      isHelpOpen,
      setActiveDialog: actions.setActiveDialog,
      closeDialog: actions.closeDialog,
      enqueueConfirmation: actions.enqueueConfirmation,
      resolveConfirmation: actions.resolveConfirmation,
      toggleCardExpansion: actions.toggleCardExpansion,
      setCardExpanded: actions.setCardExpanded,
      expandAllCards: actions.expandAllCards,
      collapseAllCards: actions.collapseAllCards,
      setFocusedComponent: actions.setFocusedComponent,
      setActiveTab: actions.setActiveTab,
      setTerminalDimensions: actions.setTerminalDimensions,
      openConfirmation: actions.openConfirmation,
      closeConfirmation: actions.closeConfirmation,
      toggleHelp: actions.toggleHelp,
    };
  }, [state, actions]);

  return <UIStateContext.Provider value={contextValue}>{children}</UIStateContext.Provider>;
};

export function useUIState(): UIStateContextValue {
  const ctx = useContext(UIStateContext);
  if (!ctx) {
    throw new Error('useUIState must be used within a UIStateProvider');
  }
  return ctx;
}
