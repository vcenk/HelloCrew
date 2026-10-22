import { Buddy, type BuddyVariant } from "@/components/brand";

/**
 * Marketing-only preview of the crew. It exists to make one point: different
 * agents have different jobs. Deliberately not the dashboard's character
 * system — the characters here are decorative and every role is named in text.
 */
const crew: {
  variant: BuddyVariant;
  name: string;
  job: string;
  status: "working" | "soon";
}[] = [
  {
    variant: "green",
    name: "Receptionist",
    job: "Answers questions and takes booking requests for you to approve.",
    status: "working",
  },
  {
    variant: "yellow",
    name: "Reputation manager",
    job: "Watches your Google reviews and drafts replies in your words.",
    status: "working",
  },
  {
    variant: "coral",
    name: "More to come",
    job: "Phone calls and booking systems are next on the list.",
    status: "soon",
  },
];

export function CrewPreview() {
  return (
    <ul className="crew-preview" aria-label="The crew and what each one does">
      {crew.map((member) => (
        <li className="crew-preview-card" key={member.name}>
          <span className="crew-preview-art">
            <Buddy variant={member.variant} asleep={member.status === "soon"} />
          </span>
          <strong>{member.name}</strong>
          <p>{member.job}</p>
          <span className="crew-preview-tag" data-status={member.status}>
            {member.status === "working" ? (
              <>
                <span className="dot" aria-hidden="true" /> Ready to practise
              </>
            ) : (
              "Planned"
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
