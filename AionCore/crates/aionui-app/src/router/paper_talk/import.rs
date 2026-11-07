use super::{invalid, io, model::Brief};
use aionui_common::ApiError;
use sha2::{Digest, Sha256};
use std::path::Path;
use tokio::{fs, io::AsyncReadExt};
use uuid::Uuid;

pub(super) async fn snapshot(brief: &mut Brief, root: &Path) -> Result<(), ApiError> {
    let papers = root.join("sources");
    fs::create_dir_all(&papers).await.map_err(io)?;
    let mut inputs = Vec::new();
    for source in &brief.inputs {
        let source = fs::canonicalize(source).await.map_err(io)?;
        if source.starts_with(fs::canonicalize(&papers).await.map_err(io)?) {
            if !inputs.contains(&source) {
                inputs.push(source);
            }
            continue;
        }
        let name = source.file_name().ok_or_else(|| invalid("Missing PDF name"))?;
        let tmp = papers.join(Uuid::new_v4().to_string());
        fs::copy(&source, &tmp).await.map_err(io)?;
        let mut reader = fs::File::open(&tmp).await.map_err(io)?;
        let mut buffer = [0u8; 65536];
        let mut digest = Sha256::new();
        let mut first = true;
        loop {
            let n = reader.read(&mut buffer).await.map_err(io)?;
            if first && !buffer[..n].starts_with(b"%PDF-") {
                fs::remove_file(&tmp).await.map_err(io)?;
                return Err(invalid("Input is not a PDF"));
            }
            if n == 0 {
                break;
            }
            first = false;
            digest.update(&buffer[..n]);
        }
        drop(reader);
        let dir = papers.join(format!("{:x}", digest.finalize()));
        fs::create_dir_all(&dir).await.map_err(io)?;
        let target = dir.join(name);
        if fs::try_exists(&target).await.map_err(io)? {
            fs::remove_file(tmp).await.map_err(io)?;
        } else {
            fs::rename(tmp, &target).await.map_err(io)?;
        }
        let target = fs::canonicalize(target).await.map_err(io)?;
        if !inputs.contains(&target) {
            inputs.push(target);
        }
    }
    brief.inputs = inputs;
    Ok(())
}
