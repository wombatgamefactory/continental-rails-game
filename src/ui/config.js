// config.js - the values the designer fills in at release.
//
// The repository is public, so BOTH of the first two stay empty in the source.
// Nothing else in the code may contain an email address or an analytics id; the
// rest of the UI reads them from here. Empty means "off": no mailto: link is
// shown and the analytics module makes no request of any kind.

export const CONFIG = {
  /** Where "Email this report" goes. Empty: the mailto: link is not shown at all. */
  BUG_REPORT_EMAIL: '',
  /** A GA4 measurement id (the "G-" code from the GA4 data stream). Empty: analytics is a no-op, no script is added, no request is made. */
  GA4_MEASUREMENT_ID: '',
  /**
   * A short label for the version this page was published from; written into every bug report. A label that
   * stays true (a stage and a date), not a commit hash the file cannot know. Update it when publishing a new stage.
   */
  BUILD: 'prototype 2026-10-11',
  /**
   * Play time for the landing page's stat strip, as the designer wants it printed ("90-120 min").
   * Empty: the strip shows no play-time entry at all. Never guessed by the code.
   */
  PLAY_TIME: '',
  /** Age rating for the stat strip ("14+"). Empty: no age entry. */
  AGE: '',
};
