use serde::{Deserialize, Serialize};
use std::path::PathBuf;
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Brief {
    pub direction: String,
    pub intent: String,
    pub count: u16,
    pub minutes: u16,
    pub region: String,
    pub months: u16,
    pub strict_quartile: bool,
    pub style: String,
    pub inputs: Vec<PathBuf>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Paper {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub doi: String,
    pub source: String,
    pub journal: String,
    pub date: String,
    pub finding: String,
    pub role: String,
    pub ranking: String,
    #[serde(default)]
    pub ranking_source: String,
    pub version: String,
    #[serde(default)]
    pub access: Option<String>,
    pub pdf: Option<PathBuf>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Evidence {
    pub paper: String,
    pub page: u32,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Slide {
    pub title: String,
    pub body: String,
    pub notes: String,
    pub seconds: u32,
    #[serde(default)]
    pub table: Vec<Vec<String>>,
    pub evidence: Vec<Evidence>,
    pub figure: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub design: Option<SlideDesign>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SlideLayout {
    Cover,
    Concept,
    Comparison,
    Figure,
    Mechanism,
    Evidence,
    Discussion,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SlideDesign {
    pub layout: SlideLayout,
    pub subtitle: String,
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub points: Vec<DesignPoint>,
    #[serde(default)]
    pub comparisons: Vec<DesignComparison>,
    #[serde(default)]
    pub annotations: Vec<FigureAnnotation>,
    #[serde(default)]
    pub metrics: Vec<DesignMetric>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct DesignPoint {
    pub title: String,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct DesignComparison {
    pub label: String,
    pub baseline: String,
    pub change: String,
    pub effect: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct FigureAnnotation {
    pub label: String,
    pub rect: [f64; 4],
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct DesignMetric {
    pub label: String,
    pub unit: String,
    pub baseline_label: String,
    pub baseline: f64,
    pub result_label: String,
    pub result: f64,
    pub axis_max: f64,
    pub decimals: u8,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Report {
    pub id: String,
    #[serde(default)]
    pub workspace: PathBuf,
    #[serde(default)]
    pub conversation: Option<String>,
    pub revision: u64,
    pub brief: Brief,
    pub papers: Vec<Paper>,
    pub selected: Vec<String>,
    pub outline: Vec<Slide>,
    pub outline_current: bool,
    pub deck: Option<PathBuf>,
    #[serde(default)]
    pub published: Option<Published>,
    pub job: Option<Job>,
    #[serde(default)]
    pub turns: Vec<Turn>,
    #[serde(default)]
    pub cards: Vec<ChoiceCard>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ChoiceCard {
    pub id: String,
    pub created_at: i64,
    pub revision: u64,
    pub kind: String,
    pub brief: Brief,
    pub papers: Vec<Paper>,
    pub selected: Vec<String>,
    pub outline: Vec<Slide>,
    pub deck: Option<PathBuf>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Search,
    Outline,
    Revise,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Job {
    pub id: String,
    pub stage: Stage,
    pub workspace: PathBuf,
    pub conversation: Option<String>,
    pub instruction: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Turn {
    pub user: String,
    pub answer: String,
}

#[derive(Deserialize)]
pub struct Edit {
    pub revision: u64,
    pub brief: Brief,
    pub selected: Vec<String>,
    pub outline: Vec<Slide>,
}

#[derive(Deserialize)]
pub struct Start {
    pub revision: u64,
    pub stage: Stage,
    pub instruction: String,
    #[serde(default)]
    pub files: Vec<crate::chat_file::ChatFileRef>,
}

#[derive(Deserialize)]
pub struct Binding {
    pub conversation: String,
}

#[derive(Deserialize)]
pub struct Selection {
    pub intent: String,
    pub papers: Vec<Paper>,
    pub selected: Vec<String>,
}

#[derive(Deserialize)]
pub struct Confirm {
    pub revision: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Published {
    pub path: PathBuf,
    pub revision: u64,
    pub slides: Vec<Slide>,
    #[serde(default)]
    pub papers: Vec<Paper>,
}

#[cfg(test)]
mod tests {
    use super::Slide;
    use serde_json::json;

    #[test]
    fn slide_design_survives_report_roundtrip() {
        let input = json!({
            "title":"Controlled comparison","body":"Original explanation","notes":"Source details","seconds":60,
            "table":[],"evidence":[],"figure":null,
            "design":{
                "layout":"evidence","subtitle":"Same model and test set",
                "metrics":[{"label":"DSC","unit":"0–1","baseline_label":"Point","baseline":0.65,"result_label":"Mask3","result":0.85,"axis_max":1.0,"decimals":2}],
                "annotations":[{"label":"Read these rows","rect":[0.0,0.2,1.0,0.3]}]
            }
        });
        let slide: Slide = serde_json::from_value(input.clone()).unwrap();
        let saved = serde_json::to_value(slide).unwrap();
        assert_eq!(saved["design"]["metrics"], input["design"]["metrics"]);
        assert_eq!(saved["design"]["annotations"], input["design"]["annotations"]);
        let mut legacy = input;
        legacy.as_object_mut().unwrap().remove("design");
        assert!(serde_json::from_value::<Slide>(legacy).is_ok());
    }
}
