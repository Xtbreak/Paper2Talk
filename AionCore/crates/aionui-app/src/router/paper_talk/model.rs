pub(super) use aionui_api_types::paper_talk::*;
use aionui_common::ApiError;
use std::path::Path;
pub fn check_export_confirmation(result: &serde_json::Value, report: &Report, task: &Job) -> Result<(), ApiError> {
    if result.get("export").and_then(serde_json::Value::as_bool) != Some(true)
        || task.stage != Stage::Revise
        || ["brief", "papers", "selected", "outline", "count", "minutes", "choice"]
            .iter()
            .any(|key| result.get(key).is_some())
    {
        return Err(ApiError::BadRequest(
            "Export confirmation must not change the report".into(),
        ));
    }
    if result.get("confirm_revision").and_then(serde_json::Value::as_u64) != Some(report.revision) {
        return Err(ApiError::Conflict(
            "Export confirmation refers to a different revision".into(),
        ));
    }
    if !report.outline_current || report.outline.is_empty() {
        return Err(ApiError::BadRequest("Confirm the current outline first".into()));
    }
    Ok(())
}

pub fn check_brief(brief: &Brief) -> Result<(), ApiError> {
    if !(1..=20).contains(&brief.count)
        || !(1..=180).contains(&brief.minutes)
        || !(1..=120).contains(&brief.months)
        || !["international", "domestic", "all"].contains(&brief.region.as_str())
        || !super::styles::valid(&brief.style)
    {
        return Err(ApiError::BadRequest("Invalid report brief".into()));
    }
    for file in &brief.inputs {
        if !file.is_absolute() || !file.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) || !file.is_file() {
            return Err(ApiError::BadRequest(format!("PDF unavailable: {}", file.display())));
        }
    }
    Ok(())
}

pub fn inside(file: &Path, root: &Path) -> bool {
    file.canonicalize()
        .ok()
        .zip(root.canonicalize().ok())
        .is_some_and(|(f, r)| f.starts_with(r) && f.is_file())
}

pub fn check_outline(slides: &[Slide], report: &Report, root: &Path) -> Result<(), ApiError> {
    if slides.is_empty() || slides.len() > 80 {
        return Err(ApiError::BadRequest("Invalid slide count".into()));
    }
    for slide in slides {
        check_design(slide)?;
        if slide.title.trim().is_empty() || slide.notes.trim().is_empty() || slide.seconds == 0 {
            return Err(ApiError::BadRequest(
                "Each slide needs a title, speaking notes and duration".into(),
            ));
        }
        if let Some(header) = slide.table.first()
            && (slide.evidence.is_empty()
                || !(2..=4).contains(&header.len())
                || !(2..=6).contains(&slide.table.len())
                || slide
                    .table
                    .iter()
                    .any(|row| row.len() != header.len() || row.iter().any(|v| v.trim().is_empty())))
        {
            return Err(ApiError::BadRequest(
                "Evidence table needs 2–4 columns and matching rows".into(),
            ));
        }
        for e in &slide.evidence {
            if !report.selected.contains(&e.paper)
                || e.page == 0
                || !report.papers.iter().any(|p| p.id == e.paper && p.pdf.is_some())
            {
                return Err(ApiError::BadRequest(
                    "Evidence must reference a selected PDF and page".into(),
                ));
            }
        }
        if let Some(f) = &slide.figure
            && (slide.evidence.is_empty()
                || !inside(f, root)
                || !f.extension().is_some_and(|e| e.eq_ignore_ascii_case("png")))
        {
            return Err(ApiError::BadRequest(
                "Figure must be a report PNG with a source page".into(),
            ));
        }
    }
    Ok(())
}

pub fn check_design(slide: &Slide) -> Result<(), ApiError> {
    let Some(d) = &slide.design else { return Ok(()) };
    let bad = |message: &str| ApiError::BadRequest(message.into());
    if d.subtitle.trim().is_empty()
        || d.points.len() > 4
        || d.comparisons.len() > 3
        || d.metrics.len() > 2
        || d.annotations.len() > 3
    {
        return Err(bad("Slide design needs a subtitle and bounded explanation groups"));
    }
    for a in &d.annotations {
        let [x, y, w, h] = a.rect;
        if slide.figure.is_none()
            || a.label.trim().is_empty()
            || !a.rect.iter().all(|v| v.is_finite())
            || x < 0.0
            || y < 0.0
            || w <= 0.0
            || h <= 0.0
            || x + w > 1.000001
            || y + h > 1.000001
        {
            return Err(bad("Figure annotation must lie inside its source image"));
        }
    }
    for m in &d.metrics {
        if ![m.baseline, m.result, m.axis_max].iter().all(|v| v.is_finite())
            || m.axis_max <= 0.0
            || m.baseline < 0.0
            || m.result < 0.0
            || m.baseline > m.axis_max
            || m.result > m.axis_max
            || m.decimals > 4
        {
            return Err(bad("Metric values must fit a positive zero-based axis"));
        }
        if [
            m.label.as_str(),
            m.unit.as_str(),
            m.baseline_label.as_str(),
            m.result_label.as_str(),
        ]
        .iter()
        .any(|v| v.trim().is_empty())
            || slide.evidence.is_empty()
        {
            return Err(bad("Metric comparison needs labels, units and source evidence"));
        }
    }
    if d.points
        .iter()
        .any(|p| p.title.trim().is_empty() || p.text.trim().is_empty())
        || d.comparisons.iter().any(|r| {
            [&r.label, &r.baseline, &r.change, &r.effect]
                .iter()
                .any(|v| v.trim().is_empty())
        })
    {
        return Err(bad("Visual explanations must contain concrete text"));
    }
    let valid = match d.layout {
        SlideLayout::Cover => slide.figure.is_some() && !d.key.trim().is_empty() && d.points.len() <= 1,
        SlideLayout::Concept | SlideLayout::Mechanism => slide.figure.is_some() && (1..=3).contains(&d.points.len()),
        SlideLayout::Figure => slide.figure.is_some() && d.points.is_empty(),
        SlideLayout::Comparison => {
            (2..=3).contains(&d.comparisons.len()) && d.points.is_empty() && slide.figure.is_none()
        }
        SlideLayout::Evidence => {
            (!slide.table.is_empty() || (slide.figure.is_some() && !d.metrics.is_empty())) && d.points.is_empty()
        }
        SlideLayout::Discussion => (2..=4).contains(&d.points.len()) && slide.figure.is_none(),
    };
    if !valid
        || (!d.metrics.is_empty() && d.layout != SlideLayout::Evidence)
        || (!d.comparisons.is_empty() && d.layout != SlideLayout::Comparison)
        || (!slide.table.is_empty() && (d.layout != SlideLayout::Evidence || slide.figure.is_some()))
    {
        return Err(bad("Slide design layout does not match its visual content"));
    }
    Ok(())
}
