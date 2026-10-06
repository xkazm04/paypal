//! Executable selection never invokes cmd.exe, PowerShell, or npm shim text.
use crate::{EngineId, Error};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Executable {
    pub program: PathBuf,
    pub prefix: Vec<String>,
}
impl Executable {
    pub fn direct(path: &Path) -> Result<Self, Error> {
        if !path.is_file() || (cfg!(windows) && path.extension().is_none_or(|e| e != "exe")) {
            return Err(Error::Process);
        }
        Ok(Self {
            program: path.canonicalize().map_err(|_| Error::Process)?,
            prefix: Vec::new(),
        })
    }
}
pub fn search_paths() -> Vec<PathBuf> {
    let mut paths = std::env::var_os("PATH")
        .map(|v| std::env::split_paths(&v).collect::<Vec<_>>())
        .unwrap_or_default();
    if let Some(home) = std::env::var_os("USERPROFILE") {
        paths.push(PathBuf::from(home).join(".local/bin"));
    }
    if let Some(app) = std::env::var_os("APPDATA") {
        paths.push(PathBuf::from(app).join("npm"));
    }
    paths
}
pub fn resolve_command(id: EngineId, paths: &[PathBuf]) -> Result<Executable, Error> {
    let (name, script) = match id {
        EngineId::ClaudeCode => ("claude", "node_modules/@anthropic-ai/claude-code/cli.js"),
        EngineId::CodexCli => ("codex", "node_modules/@openai/codex/bin/codex.js"),
        EngineId::Scripted => return Err(Error::Invalid),
    };
    for dir in paths {
        let direct = dir.join(if cfg!(windows) {
            format!("{name}.exe")
        } else {
            name.into()
        });
        if let Ok(exe) = Executable::direct(&direct) {
            return Ok(exe);
        }
        // Follow the package layout, not batch syntax. Shell metacharacters remain inert.
        let entry = dir.join(script);
        if dir.join(format!("{name}.cmd")).is_file() && entry.is_file() {
            let node = std::iter::once(dir)
                .chain(paths.iter())
                .map(|p| p.join("node.exe"))
                .find(|p| p.is_file());
            if let Some(node) = node {
                let mut executable = Executable::direct(&node)?;
                let canonical = entry.canonicalize().map_err(|_| Error::Process)?;
                let entry = canonical.to_str().ok_or(Error::Process)?;
                // Rust canonicalization returns verbatim Windows paths. Node's
                // main-module resolver rejects those with EISDIR, even for a
                // normal local drive. Keep canonical identity, but use the
                // ordinary absolute spelling for this argv value only.
                let entry = if cfg!(windows) {
                    if let Some(unc) = entry.strip_prefix(r"\\?\UNC\") {
                        format!(r"\\{unc}")
                    } else {
                        entry.strip_prefix(r"\\?\").unwrap_or(entry).to_owned()
                    }
                } else {
                    entry.to_owned()
                };
                executable.prefix.push(entry);
                return Ok(executable);
            }
        }
    }
    Err(Error::Process)
}
