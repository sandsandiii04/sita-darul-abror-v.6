import { 
  ExamQuestionAssessment, 
  UTSAssessmentEvent, 
  FluencyEventType, 
  TajwidEventType, 
  MakhrajEventType 
} from '../types';

export type AssessmentCategory = 'fluency' | 'tajwid' | 'makhraj';

export interface AssessmentHistoryAction {
  id: string;
  attemptId: string;
  questionNumber: number;
  category: AssessmentCategory;
  eventType: FluencyEventType | TajwidEventType | MakhrajEventType;
  label: string;
  deduction: number;
  actionType: 'ADD_EVENT' | 'REMOVE_EVENT';
  event: UTSAssessmentEvent;
  previousAssessment: ExamQuestionAssessment;
  nextAssessment: ExamQuestionAssessment;
  timestamp: number;
}

export interface QuestionHistoryStack {
  undoStack: AssessmentHistoryAction[];
  redoStack: AssessmentHistoryAction[];
}

export class UTSHistoryManager {
  private historyMap: Map<string, QuestionHistoryStack> = new Map();

  private getKey(attemptId: string, questionNumber: number): string {
    return `${attemptId}_q${questionNumber}`;
  }

  private getOrCreateStack(attemptId: string, questionNumber: number): QuestionHistoryStack {
    const key = this.getKey(attemptId, questionNumber);
    let stack = this.historyMap.get(key);
    if (!stack) {
      stack = { undoStack: [], redoStack: [] };
      this.historyMap.set(key, stack);
    }
    return stack;
  }

  /**
   * Record a new scoring action.
   * Requirement: New action MUST clear the Redo stack for that attempt + question.
   * Immutability: If attempt is submitted, mutations are rejected.
   */
  public recordAction(
    action: Omit<AssessmentHistoryAction, 'id' | 'timestamp'>,
    attemptStatus?: string
  ): AssessmentHistoryAction {
    if (attemptStatus === 'submitted') {
      throw new Error('Sesi ujian telah disubmit dan tidak dapat diubah (immutable).');
    }

    const fullAction: AssessmentHistoryAction = {
      ...action,
      id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now()
    };

    const stack = this.getOrCreateStack(action.attemptId, action.questionNumber);
    stack.undoStack.push(fullAction);
    // CLEAR redo stack on any new scoring action
    stack.redoStack = [];

    return fullAction;
  }

  /**
   * Undo the last action on the current attempt + question.
   * Returns the previous ExamQuestionAssessment state.
   */
  public undo(
    attemptId: string,
    questionNumber: number,
    attemptStatus?: string
  ): ExamQuestionAssessment | null {
    if (attemptStatus === 'submitted') {
      throw new Error('Sesi ujian telah disubmit dan tidak dapat diubah (immutable).');
    }

    const stack = this.getOrCreateStack(attemptId, questionNumber);
    if (stack.undoStack.length === 0) {
      return null;
    }

    const action = stack.undoStack.pop()!;
    stack.redoStack.push(action);

    return action.previousAssessment;
  }

  /**
   * Redo the last undone action on the current attempt + question.
   * Returns the restored ExamQuestionAssessment state.
   */
  public redo(
    attemptId: string,
    questionNumber: number,
    attemptStatus?: string
  ): ExamQuestionAssessment | null {
    if (attemptStatus === 'submitted') {
      throw new Error('Sesi ujian telah disubmit dan tidak dapat diubah (immutable).');
    }

    const stack = this.getOrCreateStack(attemptId, questionNumber);
    if (stack.redoStack.length === 0) {
      return null;
    }

    const action = stack.redoStack.pop()!;
    stack.undoStack.push(action);

    return action.nextAssessment;
  }

  public canUndo(attemptId: string, questionNumber: number): boolean {
    const stack = this.getOrCreateStack(attemptId, questionNumber);
    return stack.undoStack.length > 0;
  }

  public canRedo(attemptId: string, questionNumber: number): boolean {
    const stack = this.getOrCreateStack(attemptId, questionNumber);
    return stack.redoStack.length > 0;
  }

  public getLastAction(attemptId: string, questionNumber: number): AssessmentHistoryAction | null {
    const stack = this.getOrCreateStack(attemptId, questionNumber);
    return stack.undoStack.length > 0 ? stack.undoStack[stack.undoStack.length - 1] : null;
  }

  public clearHistory(attemptId: string, questionNumber?: number): void {
    if (questionNumber !== undefined) {
      const key = this.getKey(attemptId, questionNumber);
      this.historyMap.delete(key);
    } else {
      const keysToDelete: string[] = [];
      for (const k of this.historyMap.keys()) {
        if (k.startsWith(`${attemptId}_`)) {
          keysToDelete.push(k);
        }
      }
      keysToDelete.forEach(k => this.historyMap.delete(k));
    }
  }

  /**
   * Hitung frekuensi per jenis kesalahan untuk pertanyaan saat ini.
   * Digunakan untuk badge count pada tombol UI: e.g. "Koreksi Mandiri ×2"
   */
  public static getEventCounts(events: UTSAssessmentEvent[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const ev of events) {
      const typeKey = String(ev.type);
      counts[typeKey] = (counts[typeKey] || 0) + 1;
    }
    return counts;
  }
}

// Export singleton instance for global/app usage
export const utsHistoryManager = new UTSHistoryManager();
