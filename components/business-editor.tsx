"use client";
import { useState } from "react";
import {
  businessSchema,
  sampleBusiness,
  type BusinessProfile,
} from "@/lib/business";
export function BusinessEditor({
  value,
  disabled,
  onSave,
}: {
  value: BusinessProfile;
  disabled: boolean;
  onSave: (value: BusinessProfile) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [notice, setNotice] = useState("");
  const update = (
    key: "name" | "description" | "hours" | "bookingUrl",
    text: string,
  ) => {
    setDraft({ ...draft, [key]: text });
    setNotice("");
  };
  return (
    <section className="simple-card business-editor">
      <h2>Your sample business information</h2>
      <p>
        Use fictional business details only. Applied changes live in this tab’s
        memory and clear on refresh. When you test a question, this information
        is sent to this app’s server, never to an AI provider. Do not enter
        customer information, secrets, or personal details.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = businessSchema.safeParse(draft);
          if (!parsed.success) {
            setNotice(
              parsed.error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join(" · "),
            );
            return;
          }
          onSave(parsed.data);
          setNotice(
            "Sample information applied. Your next free-text question will use it.",
          );
        }}
      >
        <fieldset disabled={disabled}>
          <label>
            Sample business name
            <input
              value={draft.name}
              maxLength={80}
              required
              onChange={(e) => update("name", e.target.value)}
            />
          </label>
          <label>
            Business description
            <textarea
              value={draft.description}
              maxLength={400}
              required
              onChange={(e) => update("description", e.target.value)}
            />
          </label>
          <label>
            Opening hours
            <input
              value={draft.hours}
              maxLength={200}
              required
              onChange={(e) => update("hours", e.target.value)}
            />
          </label>
          <label>
            Sample booking link
            <input
              value={draft.bookingUrl}
              maxLength={500}
              placeholder="https://example.com/book"
              onChange={(e) => update("bookingUrl", e.target.value)}
            />
          </label>
          <h3>Services and sample prices</h3>
          {draft.services.map((s, i) => (
            <div className="editor-row" key={i}>
              <label>
                Service {i + 1}
                <input
                  value={s.name}
                  maxLength={80}
                  required
                  onChange={(e) => {
                    setDraft({
                      ...draft,
                      services: draft.services.map((v, j) =>
                        j === i ? { ...v, name: e.target.value } : v,
                      ),
                    });
                    setNotice("");
                  }}
                />
              </label>
              <label>
                Listed price
                <input
                  value={s.price}
                  maxLength={80}
                  required
                  onChange={(e) => {
                    setDraft({
                      ...draft,
                      services: draft.services.map((v, j) =>
                        j === i ? { ...v, price: e.target.value } : v,
                      ),
                    });
                    setNotice("");
                  }}
                />
              </label>
              <button
                type="button"
                disabled={draft.services.length === 1}
                onClick={() => {
                  setDraft({
                    ...draft,
                    services: draft.services.filter((_, j) => j !== i),
                  });
                  setNotice("");
                }}
              >
                Remove service {i + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button outline compact"
            disabled={draft.services.length >= 8}
            onClick={() => {
              setDraft({
                ...draft,
                services: [...draft.services, { name: "", price: "" }],
              });
              setNotice("");
            }}
          >
            Add service
          </button>
          <h3>Frequently asked questions</h3>
          <p>
            Practice matching uses the exact question, ignoring punctuation and
            letter case.
          </p>
          {draft.faqs.map((f, i) => (
            <div className="editor-row" key={i}>
              <label>
                Question {i + 1}
                <input
                  value={f.question}
                  maxLength={160}
                  required
                  onChange={(e) => {
                    setDraft({
                      ...draft,
                      faqs: draft.faqs.map((v, j) =>
                        j === i ? { ...v, question: e.target.value } : v,
                      ),
                    });
                    setNotice("");
                  }}
                />
              </label>
              <label>
                Saved answer
                <textarea
                  value={f.answer}
                  maxLength={500}
                  required
                  onChange={(e) => {
                    setDraft({
                      ...draft,
                      faqs: draft.faqs.map((v, j) =>
                        j === i ? { ...v, answer: e.target.value } : v,
                      ),
                    });
                    setNotice("");
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setDraft({
                    ...draft,
                    faqs: draft.faqs.filter((_, j) => j !== i),
                  });
                  setNotice("");
                }}
              >
                Remove question {i + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button outline compact"
            disabled={draft.faqs.length >= 8}
            onClick={() => {
              setDraft({
                ...draft,
                faqs: [...draft.faqs, { question: "", answer: "" }],
              });
              setNotice("");
            }}
          >
            Add FAQ
          </button>
          <div className="editor-actions">
            <button type="submit" className="button dark compact">
              Apply sample information
            </button>
            <button
              type="button"
              className="button outline compact"
              onClick={() => {
                setDraft(sampleBusiness);
                onSave(sampleBusiness);
                setNotice("Original sample restored.");
              }}
            >
              Restore sample
            </button>
          </div>
        </fieldset>
      </form>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
