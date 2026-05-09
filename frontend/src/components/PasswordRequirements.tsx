// Mirror of the user-facing rules in services/auth/password_policy.py.
// The backend also enforces a 72-byte upper bound (bcrypt's truncation
// boundary) but that's an implementation detail — surfacing it in the UI
// would only confuse users. If someone hits it, the 422 from the backend
// flows through ApiRequestError into the form's error banner.
export const PASSWORD_MIN_LENGTH = 12

type Rule = {
  label: string
  satisfied: (pw: string) => boolean
}

const RULES: Rule[] = [
  {
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    satisfied: (pw) => pw.length >= PASSWORD_MIN_LENGTH,
  },
  {
    label: 'Contains at least one digit',
    satisfied: (pw) => /\d/.test(pw),
  },
]

export function validatePasswordClient(pw: string): string[] {
  return RULES.filter((rule) => !rule.satisfied(pw)).map((rule) => rule.label)
}

type PasswordRequirementsProps = {
  password: string
  id?: string
}

export function PasswordRequirements({
  password,
  id,
}: PasswordRequirementsProps) {
  return (
    <ul id={id} className="mt-2 space-y-1 text-sm" aria-live="polite">
      {RULES.map((rule) => {
        const ok = rule.satisfied(password)
        return (
          <li
            key={rule.label}
            className={`flex items-center gap-2 ${
              ok ? 'text-accent' : 'text-secondary-text'
            }`}
          >
            <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0">
              {ok ? <CheckIcon /> : <DotIcon />}
            </span>
            <span>{rule.label}</span>
          </li>
        )
      })}
    </ul>
  )
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
      className="h-4 w-4"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  )
}

function DotIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-4 w-4 opacity-60"
    >
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
