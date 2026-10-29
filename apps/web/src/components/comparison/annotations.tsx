'use client';

import Link from 'next/link';
import * as Popover from '@radix-ui/react-popover';
import {
  ArrowFatUp,
  DotsThree,
  Highlighter,
  PaperPlaneRight,
  Trash,
  X,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { AnnotationKind, AnnotationView } from '@owm/core/client';
import {
  ANNOTATION_KIND_META,
  ANNOTATION_KINDS,
  formatHandle,
  relativeTimeAgo,
} from '@owm/core/client';
import { cn } from '@/lib/utils';
import { Avatar } from '../avatar';
import { ReportControl } from '../report-control';
import { POPOVER_SURFACE } from '../ui/popover-surface';
import {
  ActionsMenu,
  InlineEditor,
  actionItemClass,
  deleteButtonClass,
} from './content-actions';
import { KIND_ICONS } from './kinds';
import { ErrorLine } from './turn-state';

/** The width of an annotation popover, used to clamp it inside the grid. */
export const ANNOTATION_POPOVER_WIDTH = 320;
/** Breathing room so a clamped popover does not sit flush with the grid edge. */
export const ANNOTATION_POPOVER_GUTTER = 4;

/** One thread message, as stored on the Annotation. */
export type AnnotationMessage = AnnotationView['thread'][number];

/** The Turn an Annotation belongs to, shown beside the annotation's kind. */
export type AnnotationTurn = { number: number; total: number };

/** A live text selection inside one annotatable run, in grid coordinates. */
export type AnnotationSelection = {
  responseId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
  x: number;
  y: number;
  /** Viewport bottom of the selection, relative to the grid. */
  bottom: number;
};

/** The open annotation surface: a thread, or the composer for a new one. */
export type AnnotationPopoverState =
  | { mode: 'thread'; id: string; x: number; y: number }
  | {
      mode: 'new';
      responseId: string;
      startOffset: number;
      endOffset: number;
      quote: string;
      x: number;
      y: number;
    };

export type MessageEditState = {
  annotationId: string;
  id: string;
  body: string;
  busy: boolean;
  error: string | null;
};

/** The Turn an Annotation belongs to, shown beside the annotation's kind. */
export function TurnBadge({ turn }: { turn: AnnotationTurn }) {
  return (
    <span
      data-annotation-turn
      className="flex h-[22px] whitespace-nowrap items-center rounded-[var(--r)] border border-neutral-700 px-2 text-[11px] font-medium text-neutral-400"
    >
      Turn {turn.number} of {turn.total}
    </span>
  );
}

/** The Annotation owner can retag it or delete the highlight and whole thread. */
export function AnnotationActions({
  annotation,
  onChangeKind,
  onDelete,
}: {
  annotation: AnnotationView;
  onChangeKind: (annotation: AnnotationView, kind: AnnotationKind) => Promise<string | null>;
  onDelete: () => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const close = () => {
    setOpen(false);
    setConfirming(false);
    setError(null);
  };

  const cancelConfirm = () => {
    setConfirming(false);
    setError(null);
    requestAnimationFrame(() => deleteRef.current?.focus());
  };

  const choose = async (kind: AnnotationKind) => {
    setBusy(true);
    setError(null);
    const message = await onChangeKind(annotation, kind);
    setBusy(false);
    if (message) setError(message);
    else close();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const message = await onDelete();
    setBusy(false);
    if (message) setError(message);
    else close();
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        if (value) {
          setOpen(true);
          setError(null);
        } else {
          close();
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Annotation actions"
          data-actions-trigger
          className="grid h-7 w-7 place-items-center rounded-[var(--r)] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-text"
        >
          <DotsThree size={18} weight="bold" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          data-popover
          data-actions-menu
          aria-label="Annotation actions"
          className={cn(POPOVER_SURFACE, 'z-50 w-[236px] gap-0.5 p-2')}
        >
          {confirming ? (
            <>
              <span className="px-1.5 pb-2 pt-1 text-[12.5px] leading-[1.45] text-neutral-300">
                Delete this annotation and its whole thread?
              </span>
              {error && (
                <div className="px-1.5 pb-1">
                  <ErrorLine message={error} />
                </div>
              )}
              <div className="flex gap-1.5 pt-1">
                <button
                  ref={confirmRef}
                  type="button"
                  disabled={busy}
                  onClick={() => void confirm()}
                  className={deleteButtonClass}
                >
                  {busy ? 'Deleting…' : 'Delete'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={cancelConfirm}
                  className="btn-secondary h-8 flex-1"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="micro-label px-1.5 pb-1 pt-0.5">Change kind</span>
              <div className="grid grid-cols-2 gap-1 pb-1">
                {ANNOTATION_KINDS.map((value) => {
                  const Icon = KIND_ICONS[value];
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={annotation.kind === value}
                      disabled={busy}
                      onClick={() => void choose(value)}
                      className={cn(
                        'flex h-8 items-center gap-1.5 rounded-[var(--r)] border px-2 text-left text-[12.5px] font-medium transition-colors',
                        annotation.kind === value
                          ? 'border-accent bg-accent-900 text-accent-200'
                          : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800',
                      )}
                    >
                      <Icon size={13} aria-hidden />
                      {ANNOTATION_KIND_META[value].label}
                    </button>
                  );
                })}
              </div>
              {error && (
                <div className="px-1.5 pb-1">
                  <ErrorLine message={error} />
                </div>
              )}
              <div className="my-1 h-px bg-neutral-700" />
              <button
                ref={deleteRef}
                type="button"
                onClick={() => setConfirming(true)}
                className={actionItemClass}
              >
                <Trash size={15} aria-hidden />
                Delete annotation
              </button>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The floating affordance over a live selection. `mousedown` is prevented so
 * the browser keeps the range alive until the composer opens; a keyboard
 * activation arrives as a click with no button press.
 */
export function AnnotateSelectionButton({
  selection,
  onOpen,
}: {
  selection: AnnotationSelection;
  onOpen: (trigger: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => {
        event.preventDefault();
        onOpen(event.currentTarget);
      }}
      onClick={(event) => {
        if (event.detail === 0) onOpen(event.currentTarget);
      }}
      style={{ position: 'absolute', top: selection.y, left: selection.x }}
      className="anim-pop-sm z-20 flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-[var(--r)] border border-accent bg-bg px-[11px] text-[13px] font-medium text-accent-200 shadow-md"
    >
      <Highlighter size={13} aria-hidden />
      Annotate
    </button>
  );
}

function CloseAnnotationButton({
  label,
  onClose,
}: {
  label: string;
  onClose: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClose}
      className="grid h-[26px] w-[26px] place-items-center rounded-[var(--r)] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-text"
    >
      <X size={13} aria-hidden />
    </button>
  );
}

type ThreadBodyProps = {
  annotation: AnnotationView;
  people: number;
  turn: AnnotationTurn | null;
  multiTurn: boolean;
  canWrite: boolean;
  currentUserId: string | null;
  signInHref: string;
  saving: boolean;
  replyDraft: string;
  onReplyDraft: (value: string) => void;
  onSendReply: () => void;
  onVote: (annotation: AnnotationView) => void;
  onChangeKind: (annotation: AnnotationView, kind: AnnotationKind) => Promise<string | null>;
  onDeleteAnnotation: (annotation: AnnotationView) => Promise<string | null>;
  messageEdit: MessageEditState | null;
  onStartMessageEdit: (annotation: AnnotationView, message: AnnotationMessage) => void;
  onMessageBody: (body: string) => void;
  onSaveMessage: (annotation: AnnotationView, message: AnnotationMessage) => void;
  onCancelMessageEdit: () => void;
  onDeleteMessage: (
    annotation: AnnotationView,
    message: AnnotationMessage,
  ) => Promise<string | null>;
  onClose: () => void;
};

function ThreadBody({
  annotation,
  people,
  turn,
  multiTurn,
  canWrite,
  currentUserId,
  signInHref,
  saving,
  replyDraft,
  onReplyDraft,
  onSendReply,
  onVote,
  onChangeKind,
  onDeleteAnnotation,
  messageEdit,
  onStartMessageEdit,
  onMessageBody,
  onSaveMessage,
  onCancelMessageEdit,
  onDeleteMessage,
  onClose,
}: ThreadBodyProps) {
  const KindIcon = KIND_ICONS[annotation.kind as AnnotationKind] ?? KIND_ICONS.bug;
  const isOwner = canWrite && annotation.author.id === currentUserId;
  const isSelf = annotation.author.id === currentUserId;
  const ago = (value: string) => relativeTimeAgo(value);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3.5 pt-3">
        <span className="flex h-[22px] items-center gap-1.5 rounded-[var(--r)] border border-accent-700 px-2 text-[12px] font-medium text-accent-200">
          <KindIcon size={12} aria-hidden />
          {ANNOTATION_KIND_META[annotation.kind as AnnotationKind]?.label}
        </span>
        <span className="text-[12px] text-neutral-400">
          {people} {people === 1 ? 'person' : 'people'}
        </span>
        {multiTurn && turn && <TurnBadge turn={turn} />}
        <div className="ml-auto flex items-center gap-1">
          {isOwner && (
            <AnnotationActions
              annotation={annotation}
              onChangeKind={onChangeKind}
              onDelete={() => onDeleteAnnotation(annotation)}
            />
          )}
          {!isSelf && canWrite && (
            <ReportControl
              compact
              targetType="annotation"
              targetId={annotation.id}
              signedIn
              signInHref={signInHref}
            />
          )}
          <CloseAnnotationButton label="Close annotation" onClose={onClose} />
        </div>
      </div>

      <div className="mx-3.5 mt-2.5 max-h-[54px] overflow-hidden border-l-2 border-accent pl-2.5 font-mono text-[11.5px] leading-[1.5] text-neutral-300">
        {annotation.quote}
      </div>

      <div className="flex max-h-[240px] flex-col gap-3 overflow-auto px-3.5 pt-3.5">
        {annotation.thread.map((message) => {
          const canManage = canWrite && message.author.id === currentUserId && !message.deletedAt;
          const editing =
            messageEdit?.annotationId === annotation.id && messageEdit.id === message.id;
          return (
            <div key={message.id} className="flex gap-2.5">
              <Avatar handle={message.author.handle} size={22} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-1">
                  <span className="text-[12px] text-neutral-400">
                    <span className="font-medium text-neutral-100">
                      {formatHandle(message.author.handle)}
                    </span>{' '}
                    · {ago(message.createdAt)}
                  </span>
                  <div className="flex-1" />
                  {canManage && !editing && (
                    <ActionsMenu
                      label="Message actions"
                      noun="message"
                      onEdit={() => onStartMessageEdit(annotation, message)}
                      onDelete={() => onDeleteMessage(annotation, message)}
                    />
                  )}
                </div>
                {editing && messageEdit ? (
                  <InlineEditor
                    label="Edit message"
                    value={messageEdit.body}
                    onChange={onMessageBody}
                    onSave={() => onSaveMessage(annotation, message)}
                    onCancel={onCancelMessageEdit}
                    busy={messageEdit.busy}
                    error={messageEdit.error}
                  />
                ) : (
                  <span className="text-[13.5px] leading-[1.5] text-neutral-100 [text-wrap:pretty]">
                    {message.deletedAt ? (
                      <span className="italic text-neutral-500">[deleted]</span>
                    ) : (
                      message.body
                    )}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5 p-3">
        <button
          type="button"
          aria-label={
            annotation.voted
              ? `Remove annotation vote · ${annotation.votes} votes`
              : `Vote on annotation · ${annotation.votes} votes`
          }
          aria-pressed={annotation.voted}
          disabled={isSelf || !canWrite}
          onClick={() => onVote(annotation)}
          className={cn(
            'flex h-[30px] items-center gap-1.5 rounded-[var(--r)] border border-neutral-700 px-2.5 text-[12px] font-medium text-neutral-200 transition-colors',
            annotation.voted && 'bg-accent-900 text-accent-200',
            isSelf && 'cursor-not-allowed opacity-50',
          )}
        >
          <ArrowFatUp
            size={13}
            weight={annotation.voted ? 'fill' : 'regular'}
            aria-hidden
          />
          {annotation.votes}
        </button>
        {canWrite ? (
          <>
            <input
              aria-label="Reply to annotation"
              value={replyDraft}
              onChange={(event) => onReplyDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void onSendReply();
              }}
              placeholder="Reply…"
              className="h-[30px] min-w-0 flex-1 rounded-[var(--r)] border border-neutral-700 bg-surface px-2.5 text-[13px] text-text focus:border-accent"
            />
            <button
              type="button"
              aria-label="Send reply"
              disabled={saving}
              onClick={() => void onSendReply()}
              className="grid h-[30px] w-[30px] place-items-center rounded-[var(--r)] border border-accent text-accent-200 transition-colors hover:bg-accent-900 disabled:opacity-45"
            >
              <PaperPlaneRight size={13} aria-hidden />
            </button>
          </>
        ) : (
          <Link
            href={signInHref}
            className="flex h-[30px] flex-1 items-center justify-center rounded-[var(--r)] border border-neutral-700 text-[12px] font-medium text-neutral-300 transition-colors hover:text-text"
          >
            Sign in to reply
          </Link>
        )}
      </div>
    </>
  );
}

type NewAnnotationBodyProps = {
  quote: string;
  turn: AnnotationTurn | null;
  multiTurn: boolean;
  kind: AnnotationKind;
  body: string;
  error: string | null;
  saving: boolean;
  onKind: (kind: AnnotationKind) => void;
  onBody: (body: string) => void;
  onSave: () => void;
  onClose: () => void;
};

function NewAnnotationBody({
  quote,
  turn,
  multiTurn,
  kind,
  body,
  error,
  saving,
  onKind,
  onBody,
  onSave,
  onClose,
}: NewAnnotationBodyProps) {
  return (
    <>
      <div className="flex items-center gap-2 px-3.5 pt-3">
        <span className="text-[13.5px] font-medium">New annotation</span>
        {multiTurn && turn && <TurnBadge turn={turn} />}
        <div className="flex-1" />
        <CloseAnnotationButton label="Close new annotation" onClose={onClose} />
      </div>

      <div className="mx-3.5 mt-2.5 max-h-[54px] overflow-hidden border-l-2 border-accent pl-2.5 font-mono text-[11.5px] leading-[1.5] text-neutral-300">
        {quote}
      </div>

      <div className="flex flex-col gap-2.5 px-3.5 pb-3.5 pt-3">
        <div className="flex flex-wrap gap-1.5">
          {ANNOTATION_KINDS.map((value) => {
            const Icon = KIND_ICONS[value];
            const active = kind === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => onKind(value)}
                className={cn(
                  'flex h-[26px] items-center gap-1.5 rounded-[var(--r)] border px-2.5 text-[12px] font-medium transition-colors',
                  active
                    ? 'border-accent bg-accent-900 text-accent-200'
                    : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800',
                )}
              >
                <Icon size={12} aria-hidden />
                {ANNOTATION_KIND_META[value].label}
              </button>
            );
          })}
        </div>
        <textarea
          aria-label="Annotation note"
          value={body}
          onChange={(event) => onBody(event.target.value)}
          placeholder="What stands out here?"
          rows={3}
          className="resize-none rounded-[var(--r)] border border-neutral-700 bg-surface px-2.5 py-2 text-[13px] leading-[1.5] text-text focus:border-accent"
        />
        {error && <ErrorLine message={error} />}
        <button
          type="button"
          disabled={saving}
          onClick={() => void onSave()}
          className="btn-secondary h-[30px] self-start border-accent text-accent-200"
        >
          Add annotation
        </button>
      </div>
    </>
  );
}

export type AnnotationPopoverProps = {
  popover: AnnotationPopoverState;
  panelRef: RefObject<HTMLDivElement | null>;
  multiTurn: boolean;
  canWrite: boolean;
  currentUserId: string | null;
  signInHref: string;
  activeAnnotation: AnnotationView | null;
  activeAnnotationTurn: AnnotationTurn | null;
  newAnnotationTurn: AnnotationTurn | null;
  annotationPeople: number;
  saving: boolean;
  newKind: AnnotationKind;
  newBody: string;
  newError: string | null;
  onNewKind: (kind: AnnotationKind) => void;
  onNewBody: (body: string) => void;
  onSave: () => void;
  replyDraft: string;
  onReplyDraft: (value: string) => void;
  onSendReply: () => void;
  onVote: (annotation: AnnotationView) => void;
  onChangeKind: (annotation: AnnotationView, kind: AnnotationKind) => Promise<string | null>;
  onDeleteAnnotation: (annotation: AnnotationView) => Promise<string | null>;
  messageEdit: MessageEditState | null;
  onStartMessageEdit: (annotation: AnnotationView, message: AnnotationMessage) => void;
  onMessageBody: (body: string) => void;
  onSaveMessage: (annotation: AnnotationView, message: AnnotationMessage) => void;
  onCancelMessageEdit: () => void;
  onDeleteMessage: (
    annotation: AnnotationView,
    message: AnnotationMessage,
  ) => Promise<string | null>;
  onClose: (restoreFocus?: boolean) => void;
};

/**
 * The positioned annotation dialog. The parent keeps the open popover, its
 * drafts and its fetch handlers; this component owns the surface and the
 * markup so the Comparison view stays about data flow.
 */
export function AnnotationPopover({
  popover,
  panelRef,
  multiTurn,
  canWrite,
  currentUserId,
  signInHref,
  activeAnnotation,
  activeAnnotationTurn,
  newAnnotationTurn,
  annotationPeople,
  saving,
  newKind,
  newBody,
  newError,
  onNewKind,
  onNewBody,
  onSave,
  replyDraft,
  onReplyDraft,
  onSendReply,
  onVote,
  onChangeKind,
  onDeleteAnnotation,
  messageEdit,
  onStartMessageEdit,
  onMessageBody,
  onSaveMessage,
  onCancelMessageEdit,
  onDeleteMessage,
  onClose,
}: AnnotationPopoverProps) {
  const isThread = popover.mode === 'thread';
  const close = () => onClose();

  return (
    <div
      ref={panelRef}
      data-popover
      data-annotation-popover
      role="dialog"
      aria-modal="false"
      aria-label={isThread ? 'Annotation thread' : 'New annotation'}
      tabIndex={-1}
      style={{ position: 'absolute', top: popover.y, left: popover.x }}
      className={cn(
        POPOVER_SURFACE,
        'w-[min(320px,calc(100vw-32px))]',
      )}
    >
      {popover.mode === 'thread' && activeAnnotation ? (
        <ThreadBody
          annotation={activeAnnotation}
          people={annotationPeople}
          turn={activeAnnotationTurn}
          multiTurn={multiTurn}
          canWrite={canWrite}
          currentUserId={currentUserId}
          signInHref={signInHref}
          saving={saving}
          replyDraft={replyDraft}
          onReplyDraft={onReplyDraft}
          onSendReply={onSendReply}
          onVote={onVote}
          onChangeKind={onChangeKind}
          onDeleteAnnotation={onDeleteAnnotation}
          messageEdit={messageEdit}
          onStartMessageEdit={onStartMessageEdit}
          onMessageBody={onMessageBody}
          onSaveMessage={onSaveMessage}
          onCancelMessageEdit={onCancelMessageEdit}
          onDeleteMessage={onDeleteMessage}
          onClose={close}
        />
      ) : popover.mode === 'new' ? (
        <NewAnnotationBody
          quote={popover.quote}
          turn={newAnnotationTurn}
          multiTurn={multiTurn}
          kind={newKind}
          body={newBody}
          error={newError}
          saving={saving}
          onKind={onNewKind}
          onBody={onNewBody}
          onSave={onSave}
          onClose={close}
        />
      ) : null}
    </div>
  );
}
