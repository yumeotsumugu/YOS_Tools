// history.js
// Undo/Redo機能。
// 「変更が起きる直前の状態」をスナップショットとしてundoStackに積む方式。
// 連続的な操作(ドラッグでの移動・拡縮・回転・スライダー操作・文字入力)は
// 1ジェスチャーにつき1回だけ記録することで、履歴が細かくなりすぎないようにする。

window.IM = window.IM || {};

(function (IM) {
  "use strict";

  const MAX_HISTORY = 80; // 履歴上限(設計書 18章: 50〜100程度)

  class HistoryManager {
    /**
     * @param {CanvasManager} canvasManager
     */
    constructor(canvasManager) {
      this.canvasManager = canvasManager;
      this.undoStack = [];
      this.redoStack = [];
      this.onChange = null; // Undo/Redoボタンの活性状態更新などに使うコールバック
    }

    /** 現在のキャンバス状態のスナップショットを作る(imageElementの参照は共有し、それ以外は複製) */
    snapshot() {
      return {
        objects: this.canvasManager.objects.map((o) => ({ ...o })),
        selectedIds: [...this.canvasManager.selectedIds],
      };
    }

    /** 変更を加える「直前」に呼び出し、現在の状態を履歴に積む */
    record() {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.redoStack = [];
      this._notify();
    }

    /** 事前に取得しておいたスナップショットを履歴に積む(スライダー等の連続操作用) */
    commitSnapshot(beforeSnapshot) {
      this.undoStack.push(beforeSnapshot);
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.redoStack = [];
      this._notify();
    }

    canUndo() {
      return this.undoStack.length > 0;
    }

    canRedo() {
      return this.redoStack.length > 0;
    }

    undo() {
      if (!this.canUndo()) return;
      const current = this.snapshot();
      const previous = this.undoStack.pop();
      this.redoStack.push(current);
      this._restore(previous);
      this._notify();
    }

    redo() {
      if (!this.canRedo()) return;
      const current = this.snapshot();
      const next = this.redoStack.pop();
      this.undoStack.push(current);
      this._restore(next);
      this._notify();
    }

    _restore(snapshot) {
      const cm = this.canvasManager;
      cm.objects = snapshot.objects.map((o) => ({ ...o }));
      cm.selectedIds = [...snapshot.selectedIds];
      cm.render();
      cm._notifyObjectsChange();
      if (cm.onSelectionChange) cm.onSelectionChange();
    }

    _notify() {
      if (this.onChange) this.onChange();
    }
  }

  Object.assign(IM, { HistoryManager });
})(window.IM);
