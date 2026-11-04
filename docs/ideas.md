# Feature ideas

Captured November 4, 2026. These are ideas for future prioritization, not an
implementation queue or release commitment.

## Interested — scope next

### PowerPoint and PDF import

- Upload a presentation or document, select pages, and create playlist entries
  with adjustable durations.
- Replace the source file while preserving existing playlist placement.
- Start with static page conversion; presentations needing animations can use
  exported video. Preserve the current offline playback model.
- Inspiration: [OptiSigns PowerPoint support](https://support.optisigns.com/hc/en-us/articles/4414355658899-How-to-Use-Microsoft-PowerPoint-with-OptiSigns).

### QR codes with engagement tracking

- Add QR codes to slides for surveys, training, policies, and feedback forms.
- Support store-specific destinations and scan reports by site, screen, and date.
- Keep code generation simple and make tracking optional. Define destination
  access and reporting retention when scoping the feature.
- Inspiration: [ScreenCloud links and QR scan metrics](https://help.screencloud.com/en/articles/10120116-screencloud-studio-links).

### Persistent screen zones

- Combine a rotating playlist with persistent metrics, a sidebar, or a footer.
- Configure shared information once instead of repeating it on every slide.
- Start with one rotating area and lightweight persistent widgets; validate
  Android TV performance and preserve bounded player resource use.
- Inspiration: [ScreenCloud channel layouts](https://help.screencloud.com/en/articles/10110358-channels-setup-guide-scheduling-content-using-layouts-and-adding-music-to-your-screens).

## Pinned — revisit later

### Metric-driven content rules

- Use existing store metrics to select content, such as a celebration slide when
  a goal is reached or an attention message when a limit is exceeded.
- Consider priorities, cooldowns, expiration, stale-data behavior, and automatic
  return to normal playback.
- Owner response: worth revisiting later.
- Inspiration: [OptiSigns sensor-driven content](https://support.optisigns.com/hc/en-us/articles/13097501958291-OptiSigns-IoT-Sensor-Add-on-Quick-Start).

### Optional publishing approval

- Offer Draft → Pending review → Approved workflows per group or site.
- Show changes and affected screens to reviewers; keep the approved version
  playing until a replacement is accepted.
- Include revision requests and approval history, and cover edits to slides
  already used by published playlists.
- Owner response: put a pin in this.
- Inspiration: [Rise Vision publishing approval](https://help.risevision.com/hc/en-us/articles/41506732615828-Content-Publishing-Approval).

## Context from the discussion

- Templates, basic online reporting, and scheduling already exist; their earlier
  suggestions were not selected as new priorities.
- Players primarily run Android TV. Any future monitoring or screenshot ideas
  should account for its capabilities and permission limits.
- Keep the existing Slides → Playlists → Screens workflow as the foundation.
