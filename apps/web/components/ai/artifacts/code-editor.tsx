"use client";

import { python } from "@codemirror/lang-python";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

export function ArtifactCodeEditor({
  content,
  editable,
  onSave,
}: {
  content: string;
  editable: boolean;
  onSave: (content: string, debounce?: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const editableCompartment = useRef(new Compartment());
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  useEffect(() => {
    if (!containerRef.current || editorRef.current) return;
    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: content,
        extensions: [
          basicSetup,
          python(),
          oneDark,
          editableCompartment.current.of(EditorView.editable.of(editable)),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const transaction = update.transactions.find(
              (current) => !current.annotation(Transaction.remote),
            );
            if (transaction) saveRef.current(update.state.doc.toString(), true);
          }),
        ],
      }),
    });
    editorRef.current = view;
    return () => {
      view.destroy();
      editorRef.current = null;
    };
    // The view is intentionally created once; later content/editable changes
    // are applied through the effects below, matching the upstream editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = editorRef.current;
    if (!view) return;
    view.dispatch({
      effects: editableCompartment.current.reconfigure(EditorView.editable.of(editable)),
    });
  }, [editable]);

  useEffect(() => {
    const view = editorRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === content) return;
    view.dispatch({
      annotations: [Transaction.remote.of(true)],
      changes: { from: 0, to: current.length, insert: content },
    });
  }, [content]);

  return (
    <div
      className="artifact-code-editor min-h-full overflow-auto px-2 py-3 md:px-4"
      data-testid="artifact-code-editor"
      ref={containerRef}
    />
  );
}
