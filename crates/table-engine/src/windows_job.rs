//! Narrow Win32 boundary: suspended children are assigned to a kill-on-close job
//! before their first instruction. Dropping a run kills every descendant.
#![allow(unsafe_code)]
use crate::Error;
use windows::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
        },
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject,
        },
        Threading::{
            OpenProcess, OpenThread, PROCESS_SET_QUOTA, PROCESS_TERMINATE, ResumeThread,
            THREAD_SUSPEND_RESUME,
        },
    },
};

#[derive(Debug)]
pub(crate) struct Job(HANDLE);
// HANDLE is an opaque kernel handle; it is never dereferenced and the job is
// uniquely owned. The run future may move between executor threads.
unsafe impl Send for Job {}
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
#[derive(Debug)]
struct Owned(HANDLE);
impl Drop for Owned {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
impl Job {
    pub(crate) fn attach(pid: u32) -> Result<Self, Error> {
        // All successful handles are immediately wrapped. A failed attachment
        // leaves the child suspended; the caller kills/reaps it.
        unsafe {
            let job = Self(CreateJobObjectW(None, None).map_err(|_| Error::Process)?);
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            )
            .map_err(|_| Error::Process)?;
            let process = Owned(
                OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid)
                    .map_err(|_| Error::Process)?,
            );
            AssignProcessToJobObject(job.0, process.0).map_err(|_| Error::Process)?;
            let snapshot =
                Owned(CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0).map_err(|_| Error::Process)?);
            let mut entry = THREADENTRY32 {
                dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
                ..Default::default()
            };
            let mut found = false;
            Thread32First(snapshot.0, &mut entry).map_err(|_| Error::Process)?;
            loop {
                if entry.th32OwnerProcessID == pid {
                    let thread = Owned(
                        OpenThread(THREAD_SUSPEND_RESUME, false, entry.th32ThreadID)
                            .map_err(|_| Error::Process)?,
                    );
                    if ResumeThread(thread.0) == u32::MAX {
                        return Err(Error::Process);
                    }
                    found = true;
                }
                if Thread32Next(snapshot.0, &mut entry).is_err() {
                    break;
                }
            }
            if !found {
                return Err(Error::Process);
            }
            Ok(job)
        }
    }
}
