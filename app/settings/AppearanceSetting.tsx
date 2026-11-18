"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { useAppearance } from "@/app/components/useAppearance";
import { APPEARANCES, type Appearance } from "@/app/lib/experience/workspace/appearance";
import { SETTINGS_PAGE } from "@/app/lib/experience/workspace/copy";

/**
 * Auto / Light / Dark as one radio group (add-account-settings-and-help, design Decision 5). A choice applies at once;
 * there is no save button. Before hydration the stored choice is unknown, so no option is checked yet.
 */
export default function AppearanceSetting() {
  const [appearance, setAppearance] = useAppearance();

  return (
    <section aria-labelledby="appearance-title" className="rounded-panel border border-hairline bg-card p-6">
      <h2 id="appearance-title" className="font-heading text-headline-md text-ink">
        {SETTINGS_PAGE.appearanceTitle}
      </h2>
      <p id="appearance-hint" className="mt-1 text-body-sm text-ink-secondary">
        {SETTINGS_PAGE.appearanceHint}
      </p>
      <RadioGroup
        aria-labelledby="appearance-title"
        aria-describedby="appearance-hint"
        value={appearance ?? ""}
        onValueChange={(value) => setAppearance(value as Appearance)}
        className="mt-4 grid gap-3 sm:grid-cols-3"
      >
        {APPEARANCES.map((option) => {
          const copy = SETTINGS_PAGE.options[option];
          return (
            <label
              key={option}
              className="flex cursor-pointer items-start gap-3 rounded-control border border-hairline bg-card p-4 hover:border-hairline-strong has-[[data-checked]]:border-cobalt has-[[data-checked]]:bg-evidence-wash"
            >
              <Radio.Root
                value={option}
                aria-describedby={`appearance-${option}-description`}
                className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-hairline-strong bg-card data-checked:border-cobalt"
              >
                <Radio.Indicator className="size-2 rounded-full bg-cobalt" />
              </Radio.Root>
              <span>
                <span className="block text-body-md font-semibold text-ink">{copy.label}</span>
                <span id={`appearance-${option}-description`} className="block text-body-sm text-ink-secondary">
                  {copy.description}
                </span>
              </span>
            </label>
          );
        })}
      </RadioGroup>
    </section>
  );
}
