//! Read an owned native logger through a shared handle. The SDK never reads its
//! own open log with ADODB (which denies sharing). Holding the handle also lets
//! us drain the final SDK flush after the native writer closes/deletes its file.
use anyhow::{Result, ensure};
use std::path::PathBuf;
use tokio::{fs::File, io::AsyncReadExt};

const LIMIT: u64 = 16_777_216;
pub(super) struct Reader {
    path: PathBuf,
    file: Option<File>,
    read: u64,
    pending: Vec<u8>,
    encoding: Option<u8>,
    pub incomplete: bool,
}
impl Reader {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            file: None,
            read: 0,
            pending: Vec::new(),
            encoding: Some(0),
            incomplete: false,
        }
    }
    pub fn with_session_encoding(mut self, enabled: bool) -> Self {
        if enabled {
            self.encoding = None;
        }
        self
    }
    pub async fn next(&mut self, stopped: bool) -> Result<String> {
        if self.file.is_none() {
            match File::open(&self.path).await {
                Ok(file) => self.file = Some(file),
                Err(error) if !stopped && matches!(error.raw_os_error(), Some(32 | 33)) => {
                    return Ok(String::new());
                }
                Err(error) => return Err(error.into()),
            }
        }
        let file = self.file.as_mut().expect("opened above");
        ensure!(
            file.metadata().await?.len() <= LIMIT,
            "native capture log exceeds 16 MiB bound"
        );
        let mut bytes = vec![0; 65_536];
        let count = file.read(&mut bytes).await?;
        self.read += count as u64;
        ensure!(self.read <= LIMIT, "native capture log exceeds read bound");
        self.pending.extend_from_slice(&bytes[..count]);
        Ok(self.decode())
    }
    pub async fn next_batch(&mut self, stopped: bool) -> Result<String> {
        // Drain up to 1 MiB of already available bytes per native poll. The
        // logger remains asynchronous; an empty read yields immediately rather
        // than waiting for more data or issuing an additional native request.
        let mut output = String::new();
        for _ in 0..16 {
            let piece = self.next(stopped).await?;
            if piece.is_empty() {
                break;
            }
            output.push_str(&piece);
        }
        Ok(output)
    }
    fn decode(&mut self) -> String {
        if self.encoding.is_none() {
            if self.pending.is_empty() {
                return String::new();
            }
            let needed = match self.pending[0] {
                0xff | 0xfe => 2,
                0xef => 3,
                _ => 1,
            };
            if self.pending.len() < needed {
                return String::new();
            }
            if self.pending.starts_with(&[0xff, 0xfe]) {
                self.encoding = Some(1);
                self.pending.drain(..2);
            } else if self.pending.starts_with(&[0xfe, 0xff]) {
                self.encoding = Some(2);
                self.pending.drain(..2);
            } else {
                self.encoding = Some(0);
                if self.pending.starts_with(&[0xef, 0xbb, 0xbf]) {
                    self.pending.drain(..3);
                }
            }
        }
        if self.encoding != Some(0) {
            return self.decode_utf16();
        }
        let mut text = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(valid) => {
                    text.push_str(valid);
                    self.pending.clear();
                    break;
                }
                Err(error) => {
                    let good = error.valid_up_to();
                    text.push_str(
                        std::str::from_utf8(&self.pending[..good]).expect("validated prefix"),
                    );
                    self.pending.drain(..good);
                    if let Some(bad) = error.error_len() {
                        self.incomplete = true;
                        text.push('\u{fffd}');
                        self.pending.drain(..bad);
                    } else {
                        break;
                    }
                }
            }
        }
        text
    }
    fn decode_utf16(&mut self) -> String {
        let mut text = String::new();
        let mut consumed = 0;
        let unit = |bytes: &[u8]| {
            if self.encoding == Some(1) {
                u16::from_le_bytes([bytes[0], bytes[1]])
            } else {
                u16::from_be_bytes([bytes[0], bytes[1]])
            }
        };
        while consumed + 2 <= self.pending.len() {
            let first = unit(&self.pending[consumed..]);
            let value = if (0xd800..=0xdbff).contains(&first) {
                if consumed + 4 > self.pending.len() {
                    break;
                }
                let second = unit(&self.pending[consumed + 2..]);
                if (0xdc00..=0xdfff).contains(&second) {
                    consumed += 2;
                    char::from_u32(
                        0x10000 + ((first as u32 - 0xd800) << 10) + second as u32 - 0xdc00,
                    )
                    .unwrap()
                } else {
                    self.incomplete = true;
                    '\u{fffd}'
                }
            } else if (0xdc00..=0xdfff).contains(&first) {
                self.incomplete = true;
                '\u{fffd}'
            } else {
                char::from_u32(first as u32).unwrap()
            };
            consumed += 2;
            text.push(value);
        }
        self.pending.drain(..consumed);
        text
    }
    pub fn finish(&mut self) -> String {
        let mut text = self.decode();
        if self.pending.is_empty() {
            return text;
        }
        self.incomplete = true;
        if self.encoding == Some(0) {
            text.push_str(&String::from_utf8_lossy(&self.pending));
        } else {
            text.push('\u{fffd}');
        }
        self.pending.clear();
        text
    }
    pub async fn cleanup(&self) -> Result<()> {
        tokio::fs::remove_file(&self.path).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn session_log_boms_and_surrogate_pairs_survive_every_byte_boundary() {
        let expected = "BEGIN\n前🙂后\n\nEND 7\n";
        for little in [true, false] {
            let mut bytes = if little {
                vec![0xff, 0xfe]
            } else {
                vec![0xfe, 0xff]
            };
            for u in expected.encode_utf16() {
                bytes.extend_from_slice(&if little {
                    u.to_le_bytes()
                } else {
                    u.to_be_bytes()
                });
            }
            let mut r = Reader::new(PathBuf::new()).with_session_encoding(true);
            let mut out = String::new();
            for byte in bytes {
                r.pending.push(byte);
                out.push_str(&r.decode());
            }
            out.push_str(&r.finish());
            assert_eq!(out, expected);
            assert!(!r.incomplete);
            r.pending.extend_from_slice(&if little {
                0xd800u16.to_le_bytes()
            } else {
                0xd800u16.to_be_bytes()
            });
            assert_eq!(r.finish(), "�");
            assert!(r.incomplete);
        }
    }
    #[test]
    fn split_utf8_and_invalid_bytes_are_reported_without_losing_the_prefix() {
        let mut r = Reader::new(PathBuf::new());
        let encoded = "前🙂后".as_bytes();
        let mut out = String::new();
        for byte in encoded {
            r.pending.push(*byte);
            out.push_str(&r.decode());
        }
        assert_eq!(out, "前🙂后");
        assert!(!r.incomplete);
        r.pending.extend_from_slice(&[b'x', 0xff, 0xe4]);
        assert_eq!(r.decode(), "x�");
        assert_eq!(r.finish(), "�");
        assert!(r.incomplete);
    }
    #[tokio::test]
    async fn reader_observes_appends_and_keeps_its_handle_after_unlink() {
        let p = std::env::temp_dir().join(format!("capture-{}.raw", uuid::Uuid::new_v4()));
        std::fs::write(&p, "first\n").unwrap();
        let mut r = Reader::new(p.clone());
        assert_eq!(r.next(false).await.unwrap(), "first\n");
        use std::io::Write;
        let mut writer = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
        writer.write_all("中文\n".as_bytes()).unwrap();
        writer.flush().unwrap();
        drop(writer);
        std::fs::remove_file(&p).unwrap();
        assert_eq!(r.next(true).await.unwrap(), "中文\n");
    }
    #[tokio::test]
    async fn bounded_bursts_preserve_utf8_across_more_than_one_megabyte() {
        let p = std::env::temp_dir().join(format!("burst-{}.raw", uuid::Uuid::new_v4()));
        let expected = "🙂中文x".repeat(120_000);
        std::fs::write(&p, &expected).unwrap();
        let mut r = Reader::new(p);
        let first = r.next_batch(true).await.unwrap();
        assert!(first.len() > 1_000_000 && first.len() <= 1_048_576);
        assert_eq!(r.read, 1_048_576);
        let second = r.next_batch(true).await.unwrap();
        assert_eq!(first + &second, expected);
        assert!(r.next_batch(true).await.unwrap().is_empty());
        assert!(r.finish().is_empty());
        assert!(!r.incomplete);
        r.cleanup().await.unwrap();
    }
}
