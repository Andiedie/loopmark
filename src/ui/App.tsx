import { useEffect, useMemo, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  FileKey2,
  GripVertical,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  X
} from "lucide-react";
import type { NormalizedChoiceField, NormalizedField, NormalizedGroup, NormalizedSession } from "../shared/schema";
import {
  getInitialAnswer,
  isAnswerComplete,
  normalizeChoiceItems,
  toAnswerItem,
  type ChoiceAnswerItem,
  type SubmittedAnswer
} from "../shared/answer-state";
import { fieldErrorsFromSubmitReport, validateSubmitPayload } from "../shared/submission";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/utils";

type AnswerState = Record<string, SubmittedAnswer>;
type FieldErrors = Record<string, string | undefined>;
type ChoiceDraftState = Record<string, ChoiceOptionDraft[]>;
type ChoiceOptionDraft = ChoiceAnswerItem & {
  key: string;
  custom?: true;
};
type RankingItemDraft = ChoiceAnswerItem & {
  key: string;
};
type ChoicePanel = "custom" | "details" | null;

class TextInputSafeKeyboardSensor extends KeyboardSensor {
  static activators = KeyboardSensor.activators.map((activator) => ({
    ...activator,
    handler: (...args: Parameters<typeof activator.handler>) => {
      const [event] = args;
      const target = event.target;

      if (isTextEditingTarget(target)) {
        return false;
      }

      return activator.handler(...args);
    }
  }));
}

export function App() {
  const token = useMemo(() => getTokenFromPath(window.location.pathname), []);
  const [session, setSession] = useState<NormalizedSession | null>(null);
  const [answers, setAnswers] = useState<AnswerState>({});
  const [choiceDrafts, setChoiceDrafts] = useState<ChoiceDraftState>({});
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let alive = true;

    fetch(`/api/session?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Session request failed with ${response.status}.`);
        }
        return (await response.json()) as NormalizedSession;
      })
      .then((loadedSession) => {
        if (!alive) {
          return;
        }

        setSession(loadedSession);
        setAnswers(createInitialAnswers(loadedSession));
        setChoiceDrafts(createInitialChoiceDrafts(loadedSession));
      })
      .catch((error) => {
        if (alive) {
          setLoadError(error instanceof Error ? error.message : "Unable to load session.");
        }
      });

    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    document.title = session ? `${session.title} - Loopmark` : "Loopmark";
  }, [session]);

  const progress = useMemo(() => {
    if (!session) {
      return { required: 0, complete: 0, total: 0 };
    }

    const fields = flattenGroups(session.groups);
    const required = fields.filter((field) => field.required);
    return {
      required: required.length,
      complete: required.filter((field) => isAnswerComplete(field, answers[field.id])).length,
      total: fields.length
    };
  }, [answers, session]);

  if (loadError) {
    return <MessageScreen title="Unable to load Loopmark" message={loadError} />;
  }

  if (!session) {
    return <MessageScreen title="Loading Loopmark" message="Preparing the local input page." loading />;
  }

  const percent = progress.required === 0 ? 100 : Math.round((progress.complete / progress.required) * 100);
  const isUngroupedSession =
    session.groups.length === 1 && session.groups[0].id === "questions" && session.groups[0].title === session.title;
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean);

  function updateAnswer(fieldId: string, answer: SubmittedAnswer) {
    setAnswers((current) => ({ ...current, [fieldId]: answer }));
    setFieldErrors((current) => ({ ...current, [fieldId]: undefined }));
  }

  function updateChoiceDrafts(fieldId: string, drafts: ChoiceOptionDraft[]) {
    setChoiceDrafts((current) => ({ ...current, [fieldId]: drafts }));
  }

  function resetField(field: NormalizedField) {
    const confirmed = window.confirm(`Reset "${field.label}" to its initial answer?`);
    if (!confirmed) {
      return;
    }

    setAnswers((current) => ({ ...current, [field.id]: getInitialAnswer(field) }));
    setFieldErrors((current) => ({ ...current, [field.id]: undefined }));
    if (field.type === "choice") {
      setChoiceDrafts((current) => ({ ...current, [field.id]: createInitialChoiceDraftsForField(field) }));
    }
  }

  function toggleGroup(groupId: string) {
    setCollapsedGroups((current) => ({ ...current, [groupId]: !current[groupId] }));
  }

  function jumpToField(fieldId: string) {
    const element = document.getElementById(`field-${fieldId}`);
    if (typeof element?.scrollIntoView === "function") {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function revealField(fieldId: string) {
    const group = session?.groups.find((candidate) => candidate.fields.some((field) => field.id === fieldId));

    if (group) {
      setCollapsedGroups((current) => ({ ...current, [group.id]: false }));
    }

    window.setTimeout(() => jumpToField(fieldId), 0);
  }

  async function submit() {
    if (!session) {
      return;
    }

    const nextErrors = validateAnswers(session, answers);
    setFieldErrors(nextErrors);

    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      revealField(firstInvalid);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/submit?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers })
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `Submit failed with ${response.status}.`);
      }

      setSubmitted(true);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to submit answers.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <MessageScreen
        title="Inputs submitted"
        message="You can return to the agent. Loopmark has written the final JSON to stdout."
      />
    );
  }

  return (
    <main className="min-h-screen bg-paper-50 text-paper-ink">
      <header className="sticky top-0 z-20 border-b border-paper-line bg-paper-50">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:justify-between md:px-8 lg:px-10">
          <div className="flex min-w-0 items-center gap-3 md:gap-4">
            <img
              src="/icon-192.png"
              alt="Loopmark"
              className="h-8 w-8 shrink-0"
              width={32}
              height={32}
            />
            <h1 className="min-w-0 max-w-2xl truncate text-sm text-paper-muted md:text-base">{session.title}</h1>
          </div>
          <div className="w-full md:w-80">
            <div className="flex items-center justify-between gap-4 text-sm text-paper-muted">
              <span className="whitespace-nowrap">
                {progress.complete} / {progress.required} required answered
              </span>
              <span className="whitespace-nowrap tabular-nums">{percent}%</span>
            </div>
            <div className="mt-2 h-1.5 bg-paper-200">
              <div className="h-full bg-paper-accent transition-all" style={{ width: `${percent}%` }} />
            </div>
          </div>
        </div>
      </header>

      <div
        className={cn(
          "mx-auto grid w-full max-w-7xl px-5 py-10 md:px-8 lg:px-10",
          !isUngroupedSession && "gap-10 md:grid-cols-[220px_minmax(0,1fr)] lg:gap-14"
        )}
      >
        {!isUngroupedSession ? (
          <aside className="hidden md:block">
            <div className="sticky top-24 flex flex-col gap-7">
              <div>
                <p className="font-serif text-base text-paper-muted">Outline</p>
              </div>
              <nav className="flex flex-col gap-2">
                {session.groups.map((group, index) => (
                  <a
                    key={group.id}
                    href={`#group-${group.id}`}
                    className="flex items-center justify-between gap-3 border-l border-transparent px-3 py-2 text-sm text-paper-muted hover:border-paper-accent hover:text-paper-ink"
                  >
                    <span className="min-w-0 leading-5">
                      {index + 1}. {group.title}
                    </span>
                    <span className="shrink-0 whitespace-nowrap tabular-nums">{groupProgress(group, answers)}</span>
                  </a>
                ))}
              </nav>
              <div className="border-t border-paper-line pt-5 text-xs leading-5 text-paper-muted">
                Answers stay local. Secrets use temporary files.
              </div>
            </div>
          </aside>
        ) : null}

        <section className={cn("min-w-0", isUngroupedSession && "mx-auto w-full max-w-5xl")}>
          <div className="mb-8 border-b border-paper-line pb-6">
            <p className="font-serif text-4xl leading-tight md:text-5xl">{session.title}</p>
            {session.description ? <p className="mt-3 max-w-2xl text-base leading-7 text-paper-muted">{session.description}</p> : null}
          </div>

          <div className="flex flex-col">
            {session.groups.map((group, groupIndex) => {
              if (isUngroupedSession) {
                return (
                  <section key={group.id} className="scroll-mt-32">
                    <div className="flex flex-col">
                      {group.fields.map((field, fieldIndex) => (
                        <FieldBlock
                          key={field.id}
                          field={field}
                          index={`${fieldIndex + 1}`}
                          simple={isUngroupedSession}
                          first={fieldIndex === 0}
                          answer={answers[field.id]}
                          error={fieldErrors[field.id]}
                          dirty={isFieldDirty(field, answers[field.id], choiceDrafts[field.id])}
                          choiceDrafts={field.type === "choice" ? choiceDrafts[field.id] : undefined}
                          onChange={(answer) => updateAnswer(field.id, answer)}
                          onChoiceDraftsChange={(drafts) => updateChoiceDrafts(field.id, drafts)}
                          onReset={() => resetField(field)}
                        />
                      ))}
                    </div>
                  </section>
                );
              }

              const collapsed = collapsedGroups[group.id] ?? false;
              return (
                <section
                  id={`group-${group.id}`}
                  key={group.id}
                  className="scroll-mt-32 border-t border-paper-line py-10 first:border-t-0 first:pt-0"
                >
                  <button
                    type="button"
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-4 text-left"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={!collapsed}
                  >
                    <div className="flex min-w-0 gap-5">
                      <span className="pt-1 font-serif text-2xl text-paper-accent tabular-nums">{groupIndex + 1}</span>
                      <span>
                        <span className="block font-serif text-3xl leading-tight">{group.title}</span>
                        {group.description ? (
                          <span className="mt-2 block text-sm leading-6 text-paper-muted">{group.description}</span>
                        ) : null}
                      </span>
                    </div>
                    <span className="flex shrink-0 items-center gap-3 whitespace-nowrap text-sm tabular-nums text-paper-muted">
                      {groupProgress(group, answers)}
                      {collapsed ? <ChevronRight aria-hidden /> : <ChevronDown aria-hidden />}
                    </span>
                  </button>

                  {!collapsed ? (
                    <div className="mt-10 flex flex-col">
                      {group.fields.map((field, fieldIndex) => (
                        <FieldBlock
                          key={field.id}
                          field={field}
                          index={`${groupIndex + 1}.${fieldIndex + 1}`}
                          simple={false}
                          first={fieldIndex === 0}
                          answer={answers[field.id]}
                          error={fieldErrors[field.id]}
                          dirty={isFieldDirty(field, answers[field.id], choiceDrafts[field.id])}
                          choiceDrafts={field.type === "choice" ? choiceDrafts[field.id] : undefined}
                          onChange={(answer) => updateAnswer(field.id, answer)}
                          onChoiceDraftsChange={(drafts) => updateChoiceDrafts(field.id, drafts)}
                          onReset={() => resetField(field)}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>

          <ActionBar
            hasErrors={hasFieldErrors}
            submitting={submitting}
            onSubmit={submit}
          />
        </section>
      </div>
    </main>
  );
}

function ActionBar(input: {
  hasErrors: boolean;
  submitting: boolean;
  onSubmit: () => void;
}) {
  const { hasErrors, submitting, onSubmit } = input;

  return (
    <div className="mt-8 flex flex-col gap-4 border-t border-paper-line py-6 md:flex-row md:items-center md:justify-between">
      <p className="max-w-xl text-sm leading-6 text-paper-muted">
        {hasErrors ? "Fix the highlighted questions before continuing." : "Review your answers, then submit them back to the agent."}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="primary" onClick={onSubmit} disabled={submitting}>
          {submitting ? <Loader2 aria-hidden className="animate-spin" /> : null}
          Submit inputs
        </Button>
      </div>
    </div>
  );
}

function FieldBlock(input: {
  field: NormalizedField;
  index: string;
  simple: boolean;
  first: boolean;
  answer: SubmittedAnswer | undefined;
  error?: string;
  dirty: boolean;
  choiceDrafts?: ChoiceOptionDraft[];
  onChange: (answer: SubmittedAnswer) => void;
  onChoiceDraftsChange: (drafts: ChoiceOptionDraft[]) => void;
  onReset: () => void;
}) {
  const { field, index, simple, first, answer, error, dirty, choiceDrafts, onChange, onChoiceDraftsChange, onReset } = input;
  const suggestionActive = isDefaultSuggestionActive(field, answer);
  const hasStatusSlot = (field.type === "text" && field.secret) || hasDefaultSuggestion(field);
  const statusIcon = field.type === "text" && field.secret ? <SecretHint /> : suggestionActive ? <SuggestionHint /> : null;
  const labelId = `field-${field.id}-label`;
  const errorId = error ? `field-${field.id}-error` : undefined;
  const describedBy = errorId;
  const labelText = (
    <>
      {field.label}
      {field.required ? <span className="ml-1 text-paper-danger">*</span> : null}
    </>
  );

  return (
    <article
      id={`field-${field.id}`}
      className={cn(
        "grid scroll-mt-32 gap-x-6 gap-y-3 border-t border-paper-line py-7 md:grid-cols-[44px_minmax(0,1fr)]",
        first && "border-t-0 pt-0",
        !simple && "xl:grid-cols-[44px_minmax(0,980px)]",
        error && "border-t-paper-danger"
      )}
    >
      <div className="pt-1 font-serif text-sm tabular-nums text-paper-muted">{index}</div>
      <div className="min-w-0">
        <div
          className="grid min-h-9 grid-cols-[minmax(0,1fr)_2.25rem] items-start gap-3"
          data-testid={`field-${field.id}-header`}
        >
          <div className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {field.type === "text" ? (
              <label id={labelId} htmlFor={field.id} className="font-serif text-xl leading-7">
                {labelText}
              </label>
            ) : (
              <div id={labelId} className="font-serif text-xl leading-7">
                {labelText}
              </div>
            )}
            {hasStatusSlot ? (
              <span className="inline-flex h-5 w-5 items-center justify-center">
                {statusIcon ?? <span className="size-4" aria-hidden />}
              </span>
            ) : null}
          </div>
          <div className="flex h-9 w-9 items-center justify-center">
            {dirty ? (
              <Button type="button" variant="ghost" size="icon" aria-label={`Reset ${field.label}`} title="Reset answer" onClick={onReset}>
                <RotateCcw aria-hidden />
              </Button>
            ) : (
              <span className="size-9" aria-hidden />
            )}
          </div>
        </div>
        {field.description ? <p className="mt-1 text-sm leading-6 text-paper-muted">{field.description}</p> : null}
        <div className="mt-3">
          {field.type === "text" ? (
            <TextField field={field} answer={answer} onChange={onChange} invalid={Boolean(error)} describedBy={describedBy} />
          ) : (
            <ChoiceField
              field={field}
              answer={answer}
              onChange={onChange}
              invalid={Boolean(error)}
              labelledBy={labelId}
              describedBy={describedBy}
              drafts={choiceDrafts ?? createInitialChoiceDraftsForField(field)}
              onDraftsChange={onChoiceDraftsChange}
            />
          )}
        </div>
        {error ? (
          <div
            id={errorId}
            role="alert"
            className="mt-3 flex min-h-14 items-center gap-3 border border-paper-danger bg-white px-4 py-3 text-sm leading-5 text-paper-danger"
          >
            <AlertCircle aria-hidden className="size-5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function SuggestionHint() {
  return (
    <span className="group relative inline-flex h-5 items-center text-paper-accent" data-testid="agent-default-hint">
      <Sparkles aria-hidden className="size-4" />
      <span className="sr-only">Prefilled by agent</span>
      <span className="pointer-events-none absolute left-1/2 top-7 z-30 hidden w-56 -translate-x-1/2 border border-paper-line bg-white px-3 py-2 text-xs leading-5 text-paper-muted shadow-sm group-hover:block group-focus-within:block">
        Prefilled by the agent. The hint disappears after you edit the answer.
      </span>
    </span>
  );
}

function SecretHint() {
  return (
    <span className="group relative inline-flex h-5 items-center text-paper-muted">
      <Lock aria-hidden className="size-4" />
      <span className="sr-only">Secret answer is written to a local temporary file.</span>
      <span className="pointer-events-none absolute left-1/2 top-7 z-30 hidden w-56 -translate-x-1/2 border border-paper-line bg-white px-3 py-2 text-xs leading-5 text-paper-muted shadow-sm group-hover:block group-focus-within:block">
        Secret answer is written to a temporary file and omitted from stdout.
      </span>
    </span>
  );
}

function TextField(input: {
  field: Extract<NormalizedField, { type: "text" }>;
  answer: SubmittedAnswer | undefined;
  invalid: boolean;
  describedBy?: string;
  onChange: (answer: SubmittedAnswer) => void;
}) {
  const { field, answer, invalid, describedBy, onChange } = input;
  const value = answer?.type === (field.secret ? "secret" : "text") ? answer.value ?? "" : "";
  const update = (nextValue: string) => onChange({ type: field.secret ? "secret" : "text", value: nextValue });

  if (!field.secret || field.multiline) {
    return (
      <Textarea
        id={field.id}
        value={value}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        rows={field.multiline ? 5 : 3}
        onChange={(event) => update(event.target.value)}
      />
    );
  }

  return (
    <Input
      id={field.id}
      type={field.secret ? "password" : "text"}
      value={value}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      onChange={(event) => update(event.target.value)}
    />
  );
}

function ChoiceField(input: {
  field: NormalizedChoiceField;
  answer: SubmittedAnswer | undefined;
  invalid: boolean;
  labelledBy: string;
  describedBy?: string;
  drafts: ChoiceOptionDraft[];
  onDraftsChange: (drafts: ChoiceOptionDraft[]) => void;
  onChange: (answer: SubmittedAnswer) => void;
}) {
  const { field, answer, invalid, labelledBy, describedBy, drafts, onDraftsChange, onChange } = input;
  const selected = answer?.type === "choice" ? liveChoiceItems(answer.items) : [];
  const [panel, setPanel] = useState<ChoicePanel>(null);
  const selectedDrafts = selected
    .map((item) => findDraftForAnswer(drafts, item) ?? answerItemToDraft(item, `selected_${item.label}`))
    .filter((item) => item.label.trim().length > 0);

  function setItems(items: ChoiceAnswerItem[] | null) {
    if ((!items || items.length === 0) && panel === "details") {
      setPanel(null);
    }
    onChange({ type: "choice", items });
  }

  function setCleanItems(items: ChoiceAnswerItem[]) {
    setItems(items.length > 0 ? items : null);
  }

  function selectOption(item: ChoiceAnswerItem) {
    const active = selected.some((selectedItem) => choiceLabelsMatch(selectedItem, item));

    if (field.mode === "single") {
      if (active && !field.required) {
        setItems(null);
        return;
      }

      setItems([item]);
      return;
    }

    setCleanItems(active ? selected.filter((selectedItem) => !choiceLabelsMatch(selectedItem, item)) : [...selected, item]);
  }

  function addDraft(item: ChoiceAnswerItem) {
    const draft = answerItemToDraft(item, `custom_${drafts.length + 1}`, true);
    onDraftsChange([...drafts, draft]);
    setItems(field.mode === "single" ? [toAnswerItem(draft)] : [...selected, toAnswerItem(draft)]);
    setPanel(null);
  }

  function updateSelectedDraft(key: string, nextItem: ChoiceAnswerItem) {
    const previous = drafts.find((draft) => draft.key === key);
    const nextDraft = makeChoiceDraft(key, nextItem, previous?.custom);
    const nextDrafts = drafts.map((draft) => (draft.key === key ? nextDraft : draft));
    onDraftsChange(nextDrafts);
    setCleanItems(
      selected.map((item) => (previous && choiceLabelsMatch(item, previous) ? toAnswerItem(nextDraft) : item))
    );
  }

  function unselectDraft(key: string) {
    const draft = drafts.find((candidate) => candidate.key === key);
    if (!draft) {
      return;
    }
    setCleanItems(selected.filter((item) => !choiceLabelsMatch(item, draft)));
  }

  if (field.mode === "ranking") {
    return <RankingChoice field={field} items={selected} setItems={setItems} invalid={invalid} />;
  }

  return (
    <div className="flex flex-col gap-4" role="group" aria-labelledby={labelledBy} aria-describedby={describedBy} aria-invalid={invalid}>
      <div className="grid gap-2" data-testid={`choice-options-${field.id}`}>
        {drafts.map((option) => {
          const active = selected.some((item) => choiceLabelsMatch(item, option));
          return (
            <ChoiceOptionButton
              key={option.key}
              item={option}
              active={active}
              custom={option.custom}
              onClick={() => selectOption(toAnswerItem(option))}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {field.allowCustom && panel !== "details" ? (
          <CustomChoiceInput
            open={panel === "custom"}
            onOpen={() => setPanel(panel === "custom" ? null : "custom")}
            onCancel={() => setPanel(null)}
            onAdd={addDraft}
            label="Add custom answer"
          />
        ) : null}
        {field.editable && selected.length > 0 && panel !== "custom" ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setPanel(panel === "details" ? null : "details")}>
            {panel === "details" ? <Check aria-hidden /> : <Pencil aria-hidden />}
            {panel === "details" ? "Done editing" : "Edit details"}
          </Button>
        ) : null}
      </div>
      {field.editable && panel === "details" && selectedDrafts.length > 0 ? (
        <ChoiceDetailsEditor
          items={selectedDrafts}
          onChange={updateSelectedDraft}
          onRemove={unselectDraft}
          canRemove={!field.required || selected.length > 1}
          canEditLabel={field.allowCustom}
        />
      ) : null}
    </div>
  );
}

function ChoiceOptionButton(input: {
  item: Pick<ChoiceAnswerItem, "label" | "description">;
  active: boolean;
  custom?: boolean;
  onClick: () => void;
}) {
  const { item, active, custom = false, onClick } = input;

  return (
    <button
      type="button"
      title={item.description}
      className={cn(
        "grid min-h-14 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 border px-3 py-2 text-left text-sm transition-colors",
        active
          ? "border-paper-accent bg-paper-accent text-white"
          : "border-paper-line bg-white text-paper-ink hover:bg-paper-100"
      )}
      onClick={onClick}
    >
      <span className="flex h-6 items-center pt-0.5">{active ? <Check aria-hidden className="size-4" /> : <span className="size-4" />}</span>
      <span className="min-w-0">
        <span className="block font-medium leading-6">
          {item.label}
          {custom ? <span className="ml-2 text-xs font-normal opacity-75">Custom</span> : null}
        </span>
        {item.description ? <span className="mt-1 block text-xs leading-5 opacity-80">{item.description}</span> : null}
      </span>
    </button>
  );
}

function ChoiceDetailsEditor(input: {
  items: ChoiceOptionDraft[];
  onChange: (key: string, item: ChoiceAnswerItem) => void;
  onRemove: (key: string) => void;
  canRemove: boolean;
  canEditLabel: boolean;
}) {
  const { items, onChange, onRemove, canRemove, canEditLabel } = input;

  return (
    <div className="flex max-w-3xl flex-col gap-3 border-l border-paper-line pl-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-paper-muted">Selected details</p>
      {items.map((item, index) => (
        <div key={item.key} className="grid gap-2 border border-paper-line bg-white p-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            {canEditLabel ? (
              <Input
                aria-label={`Answer label ${index + 1}`}
                value={item.label}
                onChange={(event) => onChange(item.key, { ...item, label: event.target.value })}
              />
            ) : (
              <p className="min-h-9 py-1.5 text-sm font-medium leading-6 text-paper-ink">{item.label}</p>
            )}
            {canRemove ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${item.label}`}
                onClick={() => onRemove(item.key)}
              >
                <X aria-hidden />
              </Button>
            ) : null}
          </div>
          <Textarea
            aria-label={`Answer description ${index + 1}`}
            placeholder="Optional description"
            rows={2}
            className="min-h-16 resize-y py-1.5 leading-5"
            value={item.description ?? ""}
            onChange={(event) => onChange(item.key, { ...item, description: event.target.value || undefined })}
          />
        </div>
      ))}
    </div>
  );
}

function RankingChoice(input: {
  field: NormalizedChoiceField;
  items: ChoiceAnswerItem[];
  setItems: (items: ChoiceAnswerItem[] | null) => void;
  invalid: boolean;
}) {
  const { field, items, setItems, invalid } = input;
  const [panel, setPanel] = useState<ChoicePanel>(null);
  const [rows, setRows] = useState<RankingItemDraft[]>(() => createRankingDrafts(items));
  const nextKeyIndex = useRef(rows.length + 1);
  const editingDetails = panel === "details";
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TextInputSafeKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    setRows((current) => {
      if (choiceItemListsEqual(current.map(toAnswerItem), items)) {
        return current;
      }

      const reconciled = reconcileRankingDrafts(items, current);
      nextKeyIndex.current = Math.max(nextKeyIndex.current, reconciled.length + 1);
      return reconciled;
    });
  }, [items]);

  function commitRows(nextRows: RankingItemDraft[]) {
    setRows(nextRows);
    setItems(nextRows.map(toAnswerItem));
  }

  function createNextRankingKey() {
    const key = `ranking_custom_${nextKeyIndex.current}`;
    nextKeyIndex.current += 1;
    return key;
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = rows.findIndex((row) => row.key === active.id);
    const newIndex = rows.findIndex((row) => row.key === over.id);

    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    commitRows(arrayMove(rows, oldIndex, newIndex));
  }

  function move(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= rows.length) {
      return;
    }

    commitRows(arrayMove(rows, index, nextIndex));
  }

  return (
    <div className="flex flex-col gap-4" aria-invalid={invalid}>
      {editingDetails ? (
        <div className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <EditableRankingItem
              key={row.key}
              item={row}
              index={index}
              itemCount={rows.length}
              canEditLabel={field.allowCustom}
              canRemove={field.editable && (!field.required || rows.length > 1)}
              onMove={move}
              onRemove={() => commitRows(rows.filter((_, itemIndex) => itemIndex !== index))}
              onChange={(nextItem) => {
                const next = [...rows];
                next[index] = { ...nextItem, key: row.key };
                commitRows(next);
              }}
            />
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={rows.map((row) => row.key)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {rows.map((row, index) => (
                <SortableRankingItem
                  key={row.key}
                  sortableId={row.key}
                  item={row}
                  index={index}
                  itemCount={rows.length}
                  onMove={move}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {field.allowCustom && panel !== "details" ? (
          <CustomChoiceInput
            open={panel === "custom"}
            onOpen={() => setPanel(panel === "custom" ? null : "custom")}
            onCancel={() => setPanel(null)}
            onAdd={(item) => {
              commitRows([...rows, { ...item, key: createNextRankingKey() }]);
              setPanel(null);
            }}
            label="Add ranked item"
          />
        ) : null}
        {field.editable && rows.length > 0 && panel !== "custom" ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setPanel(panel === "details" ? null : "details")}>
            {panel === "details" ? <Check aria-hidden /> : <Pencil aria-hidden />}
            {panel === "details" ? "Done editing" : "Edit details"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SortableRankingItem(input: {
  sortableId: string;
  item: ChoiceAnswerItem;
  index: number;
  itemCount: number;
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  const { sortableId, item, index, itemCount, onMove } = input;
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({ id: sortableId });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : 1 }}
      data-testid="ranking-item"
      className={cn(
        "relative grid grid-cols-[22px_24px_minmax(0,1fr)_auto] gap-x-2 gap-y-2 border border-paper-line bg-white p-3",
        "sm:grid-cols-[28px_28px_minmax(0,1fr)_auto] sm:gap-x-3",
        isDragging && "border-paper-accent"
      )}
    >
      <button
        type="button"
        className="-ml-1 flex h-9 w-8 touch-none select-none items-center justify-center text-paper-muted cursor-grab active:cursor-grabbing"
        aria-label={`Drag ${item.label}`}
        data-testid="ranking-drag"
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden className="size-4" />
      </button>
      <div
        className="flex h-9 w-6 items-center justify-center font-serif text-lg leading-none text-paper-accent tabular-nums sm:w-7"
        data-testid="ranking-rank"
      >
        {index + 1}
      </div>
      <div className="min-w-0 py-1">
        <p className="text-sm font-medium leading-6 text-paper-ink">{item.label}</p>
        {item.description ? <p className="text-xs leading-5 text-paper-muted">{item.description}</p> : null}
      </div>
      <div className="flex h-9 gap-0.5 justify-end sm:gap-1" data-testid="ranking-actions">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 sm:size-9"
          aria-label={`Move ${item.label} up`}
          disabled={index === 0}
          onClick={() => onMove(index, -1)}
        >
          <ArrowUp aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 sm:size-9"
          aria-label={`Move ${item.label} down`}
          disabled={index === itemCount - 1}
          onClick={() => onMove(index, 1)}
        >
          <ArrowDown aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function EditableRankingItem(input: {
  item: ChoiceAnswerItem;
  index: number;
  itemCount: number;
  canEditLabel: boolean;
  canRemove: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: () => void;
  onChange: (item: ChoiceAnswerItem) => void;
}) {
  const { item, index, itemCount, canEditLabel, canRemove, onMove, onRemove, onChange } = input;

  return (
    <div
      data-testid="ranking-item"
      className="relative grid grid-cols-[24px_minmax(0,1fr)_auto] gap-x-2 gap-y-2 border border-paper-line bg-white p-3 sm:grid-cols-[28px_minmax(0,1fr)_auto] sm:gap-x-3"
    >
      <div
        className="flex h-9 w-6 items-center justify-center font-serif text-lg leading-none text-paper-accent tabular-nums sm:w-7"
        data-testid="ranking-rank"
      >
        {index + 1}
      </div>
      {canEditLabel ? (
        <Input
          aria-label={`Ranking label ${index + 1}`}
          value={item.label}
          onKeyDownCapture={(event) => event.stopPropagation()}
          onChange={(event) => onChange({ ...item, label: event.target.value })}
        />
      ) : (
        <div className="min-w-0 py-1">
          <p className="text-sm font-medium leading-6 text-paper-ink">{item.label}</p>
        </div>
      )}
      <div className="flex h-9 gap-0.5 justify-end sm:gap-1" data-testid="ranking-actions">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 sm:size-9"
          aria-label={`Move ${item.label} up`}
          disabled={index === 0}
          onClick={() => onMove(index, -1)}
        >
          <ArrowUp aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 sm:size-9"
          aria-label={`Move ${item.label} down`}
          disabled={index === itemCount - 1}
          onClick={() => onMove(index, 1)}
        >
          <ArrowDown aria-hidden />
        </Button>
        {canRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 sm:size-9"
            aria-label={`Remove ${item.label}`}
            onClick={onRemove}
          >
            <X aria-hidden />
          </Button>
        ) : null}
      </div>
      <Textarea
        aria-label={`Ranking description ${index + 1}`}
        placeholder="Optional description"
        rows={2}
        className="col-span-3 min-h-16 resize-y py-1.5 leading-5 sm:col-span-2 sm:col-start-2"
        value={item.description ?? ""}
        onKeyDownCapture={(event) => event.stopPropagation()}
        onChange={(event) => onChange({ ...item, description: event.target.value || undefined })}
      />
    </div>
  );
}

function CustomChoiceInput(input: {
  label: string;
  open: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onAdd: (item: ChoiceAnswerItem) => void;
}) {
  const { label, open, onOpen, onCancel, onAdd } = input;
  const [customLabel, setCustomLabel] = useState("");
  const [customDescription, setCustomDescription] = useState("");

  function reset() {
    setCustomLabel("");
    setCustomDescription("");
    onCancel();
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={onOpen}>
        <Plus aria-hidden />
        {label}
      </Button>
    );
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-2 border-l border-paper-line pl-4">
      <Input
        aria-label={`${label} label`}
        placeholder={label}
        value={customLabel}
        onChange={(event) => setCustomLabel(event.target.value)}
      />
      <Textarea
        aria-label={`${label} description`}
        placeholder="Optional description"
        rows={2}
        className="min-h-16 resize-y py-1.5 leading-5"
        value={customDescription}
        onChange={(event) => setCustomDescription(event.target.value)}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={reset}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={customLabel.trim().length === 0}
          onClick={() => {
            onAdd({
              label: customLabel.trim(),
              ...(customDescription.trim() ? { description: customDescription.trim() } : {})
            });
            reset();
          }}
        >
          <Plus aria-hidden />
          Add
        </Button>
      </div>
    </div>
  );
}

function MessageScreen(input: { title: string; message: string; loading?: boolean }) {
  const { title, message, loading = false } = input;
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper-50 px-5 text-paper-ink">
      <section className="max-w-xl border-y border-paper-line py-10 text-center">
        <div className="mb-5 flex justify-center text-paper-accent">
          {loading ? <Loader2 aria-hidden className="animate-spin" /> : <FileKey2 aria-hidden />}
        </div>
        <h1 className="font-serif text-4xl">{title}</h1>
        <p className="mt-4 text-base leading-7 text-paper-muted">{message}</p>
      </section>
    </main>
  );
}

function createInitialAnswers(session: NormalizedSession): AnswerState {
  return Object.fromEntries(flattenGroups(session.groups).map((field) => [field.id, getInitialAnswer(field)]));
}

function createInitialChoiceDrafts(session: NormalizedSession): ChoiceDraftState {
  return Object.fromEntries(
    flattenGroups(session.groups)
      .filter((field): field is NormalizedChoiceField => field.type === "choice")
      .map((field) => [field.id, createInitialChoiceDraftsForField(field)])
  );
}

function createInitialChoiceDraftsForField(field: NormalizedChoiceField): ChoiceOptionDraft[] {
  const drafts = field.options.map((option, index) =>
    answerItemToDraft(toAnswerItem(option), option.id || `option_${index + 1}`, option.custom)
  );

  for (const defaultItem of field.defaultItems) {
    const existingIndex = drafts.findIndex((draft) => choiceLabelsMatch(draft, defaultItem));
    if (existingIndex >= 0) {
      if (defaultItem.description) {
        drafts[existingIndex] = { ...drafts[existingIndex], description: defaultItem.description };
      }
    } else {
      drafts.push(answerItemToDraft(toAnswerItem(defaultItem), defaultItem.id || `default_${drafts.length + 1}`, true));
    }
  }

  return drafts;
}

function createRankingDrafts(items: ChoiceAnswerItem[]): RankingItemDraft[] {
  return items.map((item, index) => rankingItemToDraft(item, `ranking_${index + 1}`));
}

function reconcileRankingDrafts(items: ChoiceAnswerItem[], current: RankingItemDraft[]): RankingItemDraft[] {
  const usedKeys = new Set<string>();

  return items.map((item, index) => {
    const exactMatch = current.find((draft) => !usedKeys.has(draft.key) && choiceItemEquals(draft, item));

    if (exactMatch) {
      usedKeys.add(exactMatch.key);
      return exactMatch;
    }

    const samePosition = current[index];
    if (samePosition && !usedKeys.has(samePosition.key)) {
      usedKeys.add(samePosition.key);
      return { ...item, key: samePosition.key };
    }

    return rankingItemToDraft(item, `ranking_${index + 1}`);
  });
}

function answerItemToDraft(item: ChoiceAnswerItem, keyHint: string, custom?: boolean): ChoiceOptionDraft {
  return makeChoiceDraft(`${slugKey(keyHint)}_${slugKey(item.label)}`, item, custom);
}

function rankingItemToDraft(item: ChoiceAnswerItem, keyHint: string): RankingItemDraft {
  return {
    key: `${slugKey(keyHint)}_${slugKey(item.label)}`,
    label: item.label,
    ...(item.description ? { description: item.description } : {})
  };
}

function makeChoiceDraft(key: string, item: ChoiceAnswerItem, custom?: boolean): ChoiceOptionDraft {
  return {
    key,
    label: item.label,
    ...(item.description ? { description: item.description } : {}),
    ...(custom ? { custom: true } : {})
  };
}

function findDraftForAnswer(drafts: ChoiceOptionDraft[], item: ChoiceAnswerItem): ChoiceOptionDraft | undefined {
  return drafts.find((draft) => choiceLabelsMatch(draft, item));
}

function isFieldDirty(field: NormalizedField, answer: SubmittedAnswer | undefined, drafts: ChoiceOptionDraft[] | undefined): boolean {
  const initialAnswer = getInitialAnswer(field);
  if (!submittedAnswersEqual(answer, initialAnswer)) {
    return true;
  }

  if (field.type === "choice") {
    return !choiceDraftListsEqual(drafts ?? [], createInitialChoiceDraftsForField(field));
  }

  return false;
}

function submittedAnswersEqual(left: SubmittedAnswer | undefined, right: SubmittedAnswer): boolean {
  if (!left || left.type !== right.type) {
    return false;
  }

  if (left.type === "choice" && right.type === "choice") {
    return choiceItemListsEqual(normalizeChoiceItems(left.items), normalizeChoiceItems(right.items));
  }

  if (left.type === "choice" || right.type === "choice") {
    return false;
  }

  return left.value === right.value;
}

function choiceDraftListsEqual(left: ChoiceOptionDraft[], right: ChoiceOptionDraft[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => item.custom === right[index].custom && choiceItemEquals(item, right[index]));
}

function validateAnswers(session: NormalizedSession, answers: AnswerState): FieldErrors {
  const result = validateSubmitPayload(session, { answers });
  return result.ok ? {} : fieldErrorsFromSubmitReport(result.report);
}

function flattenGroups(groups: NormalizedGroup[]): NormalizedField[] {
  return groups.flatMap((group) => group.fields);
}

function liveChoiceItems(items: ChoiceAnswerItem[] | null | undefined): ChoiceAnswerItem[] {
  if (!items) {
    return [];
  }

  return items
    .filter((item) => item.label.trim().length > 0)
    .map((item) => ({
      label: item.label,
      ...(item.description !== undefined ? { description: item.description } : {})
    }));
}

function groupProgress(group: NormalizedGroup, answers: AnswerState): string {
  const required = group.fields.filter((field) => field.required);
  const complete = required.filter((field) => isAnswerComplete(field, answers[field.id])).length;
  return `${complete} / ${required.length}`;
}

function getTokenFromPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function slugKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "item";
}

function isDefaultSuggestionActive(field: NormalizedField, answer: SubmittedAnswer | undefined): boolean {
  if (field.type === "text") {
    if (!field.default || answer?.type !== (field.secret ? "secret" : "text")) {
      return false;
    }

    return (answer.value ?? "") === field.default;
  }

  if (field.defaultItems.length === 0 || answer?.type !== "choice") {
    return false;
  }

  return choiceItemListsEqual(normalizeChoiceItems(answer.items), field.defaultItems.map(toAnswerItem));
}

function hasDefaultSuggestion(field: NormalizedField): boolean {
  if (field.type === "text") {
    return Boolean(field.default);
  }

  return field.defaultItems.length > 0;
}

function choiceLabelsMatch(
  left: Pick<ChoiceAnswerItem, "label">,
  right: Pick<ChoiceAnswerItem, "label">
): boolean {
  return left.label === right.label;
}

function choiceItemEquals(left: ChoiceAnswerItem, right: ChoiceAnswerItem): boolean {
  return left.label === right.label && (left.description ?? "") === (right.description ?? "");
}

function choiceItemListsEqual(left: ChoiceAnswerItem[], right: ChoiceAnswerItem[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => choiceItemEquals(item, right[index]));
}
