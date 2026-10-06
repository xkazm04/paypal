#![allow(clippy::float_arithmetic)] // Window coordinates are logical pixels, not money.
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const FORMS: [(&str, f64, f64); 7] = [
    ("rest", 88.0, 88.0),
    ("tab", 28.0, 96.0),
    ("ticker", 420.0, 88.0),
    ("card", 440.0, 152.0),
    ("stack", 440.0, 336.0),
    ("handoff", 440.0, 160.0),
    ("welcome", 440.0, 228.0),
];
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Form {
    Rest,
    Tab,
    Ticker,
    Card,
    Stack,
    Handoff,
    Welcome,
}
impl Form {
    pub const fn size(self) -> (f64, f64) {
        match self {
            Self::Rest => (88.0, 88.0),
            Self::Tab => (28.0, 96.0),
            Self::Ticker => (420.0, 88.0),
            Self::Card => (440.0, 152.0),
            Self::Stack => (440.0, 336.0),
            Self::Handoff => (440.0, 160.0),
            Self::Welcome => (440.0, 228.0),
        }
    }
}
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Rect {
    fn valid(self) -> bool {
        self.x.is_finite()
            && self.y.is_finite()
            && self.width.is_finite()
            && self.height.is_finite()
            && self.width > 0.0
            && self.height > 0.0
            && (self.x + self.width).is_finite()
            && (self.y + self.height).is_finite()
    }
    pub fn logical(self, scale: f64) -> Result<Self, PlacementError> {
        if !self.valid() || !scale.is_finite() || scale <= 0.0 {
            return Err(PlacementError);
        }
        let rect = Self {
            x: self.x / scale,
            y: self.y / scale,
            width: self.width / scale,
            height: self.height / scale,
        };
        if !rect.valid() {
            return Err(PlacementError);
        }
        Ok(rect)
    }
}
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[ts(rename = "WindowSide")]
pub enum Side {
    Left,
    Right,
}
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VAlign {
    Up,
    Down,
}
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Placement {
    pub rect: Rect,
    pub side: Side,
    pub valign: VAlign,
}
#[derive(Debug, Error)]
#[error("invalid window rectangle or scale factor")]
pub struct PlacementError;

/// Main starts centered, with its outer bounds capped to 90% of the work area.
pub fn main_start_rect(work: Rect) -> Result<Rect, PlacementError> {
    if !work.valid() {
        return Err(PlacementError);
    }
    let width = 1440.0_f64.min(work.width * 0.9);
    let height = 900.0_f64.min(work.height * 0.9);
    Ok(Rect {
        x: work.x + (work.width - width) / 2.0,
        y: work.y + (work.height - height) / 2.0,
        width,
        height,
    })
}

/// Approval window size in logical pixels: "The Diff" (client v2), the 620 px prototype + 20 %.
pub const APPROVAL_SIZE: (f64, f64) = (744.0, 660.0);

/// Review belongs beside its opener. Flip left if needed, then clamp to the
/// opener's monitor; on a narrow screen the windows may overlap.
pub fn approval_rect(opener: Rect, work: Rect) -> Result<Rect, PlacementError> {
    if !opener.valid() || !work.valid() {
        return Err(PlacementError);
    }
    let width = APPROVAL_SIZE.0.min(work.width);
    let height = APPROVAL_SIZE.1.min(work.height);
    let right = opener.x + opener.width + 12.0;
    let left = opener.x - width - 12.0;
    let x = if right + width <= work.x + work.width {
        right
    } else if left >= work.x {
        left
    } else {
        right.clamp(work.x, work.x + work.width - width)
    };
    Ok(Rect {
        x,
        y: opener.y.clamp(work.y, work.y + work.height - height),
        width,
        height,
    })
}

/// Anchor is the resting puck. Grow from its edges; clamp only if neither side fits.
pub fn place(anchor: Rect, work: Rect, form: Form) -> Result<Placement, PlacementError> {
    if !anchor.valid() || !work.valid() {
        return Err(PlacementError);
    }
    let (width, height) = form.size();
    let width = width.min(work.width);
    let height = height.min(work.height);
    let right = anchor.x;
    let left = anchor.x + anchor.width - width;
    let down = anchor.y;
    let up = anchor.y + anchor.height - height;
    let side = if right + width <= work.x + work.width {
        Side::Right
    } else {
        Side::Left
    };
    let valign = if down + height <= work.y + work.height {
        VAlign::Down
    } else {
        VAlign::Up
    };
    let x = match side {
        Side::Right => right,
        Side::Left => left,
    }
    .clamp(work.x, work.x + work.width - width);
    let y = match valign {
        VAlign::Down => down,
        VAlign::Up => up,
    }
    .clamp(work.y, work.y + work.height - height);
    Ok(Placement {
        rect: Rect {
            x,
            y,
            width,
            height,
        },
        side,
        valign,
    })
}

#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Snap {
    MainRight,
    MainLeft,
    MainCorner,
    ScreenLeft,
    ScreenRight,
    Free,
}
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SnapResult {
    pub class: Snap,
    pub anchor: Rect,
    pub form: Form,
}
pub fn snap(
    anchor: Rect,
    work: Rect,
    visible_main: Option<Rect>,
) -> Result<SnapResult, PlacementError> {
    if !anchor.valid() || !work.valid() || visible_main.is_some_and(|m| !m.valid()) {
        return Err(PlacementError);
    }
    let mut result = SnapResult {
        class: Snap::Free,
        anchor,
        form: Form::Rest,
    };
    let tolerance = 24.0;
    if let Some(main) = visible_main {
        let right = (anchor.x - (main.x + main.width)).abs() <= tolerance;
        let left = (anchor.x + anchor.width - main.x).abs() <= tolerance;
        let aligned =
            anchor.y >= main.y - tolerance && anchor.y <= main.y + main.height + tolerance;
        if (right || left) && aligned {
            result.class = if (anchor.y - main.y).abs() <= tolerance {
                Snap::MainCorner
            } else if right {
                Snap::MainRight
            } else {
                Snap::MainLeft
            };
            result.anchor.x = if right {
                main.x + main.width
            } else {
                main.x - anchor.width
            };
            if result.class == Snap::MainCorner {
                result.anchor.y = main.y;
            }
        }
    }
    if result.class == Snap::Free {
        if (anchor.x - work.x).abs() <= tolerance {
            result.class = Snap::ScreenLeft;
            result.anchor.x = work.x;
            result.form = Form::Tab;
        } else if (anchor.x + anchor.width - work.x - work.width).abs() <= tolerance {
            result.class = Snap::ScreenRight;
            result.anchor.x = work.x + work.width - anchor.width;
            result.form = Form::Tab;
        }
    }
    result.anchor.x = result
        .anchor
        .x
        .clamp(work.x, (work.x + work.width - anchor.width).max(work.x));
    result.anchor.y = result
        .anchor
        .y
        .clamp(work.y, (work.y + work.height - anchor.height).max(work.y));
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
        Rect {
            x,
            y,
            width: w,
            height: h,
        }
    }
    #[test]
    fn main_start_size_is_capped_and_centered_on_each_scale() {
        for scale in [1.0, 1.25, 1.5] {
            for (w, h) in [(3840.0, 2160.0), (1024.0, 768.0)] {
                let work = rect(-w * scale, 100.0 * scale, w * scale, h * scale)
                    .logical(scale)
                    .unwrap();
                let main = main_start_rect(work).unwrap();
                assert!(main.width <= 1440.0 && main.width <= work.width * 0.9);
                assert!(main.height <= 900.0 && main.height <= work.height * 0.9);
                assert!(((main.x - work.x) - (work.width - main.width) / 2.0).abs() < 1e-6);
                assert!(((main.y - work.y) - (work.height - main.height) / 2.0).abs() < 1e-6);
            }
        }
        assert!(main_start_rect(rect(0.0, 0.0, f64::NAN, 100.0)).is_err());
    }

    #[test]
    fn review_flips_beside_opener_and_clamps_on_small_work_areas() {
        for scale in [1.0, 1.25, 1.5] {
            let work = rect(-1920.0 * scale, 0.0, 1920.0 * scale, 1080.0 * scale)
                .logical(scale)
                .unwrap();
            let opener = rect(-1800.0 * scale, 400.0 * scale, 460.0 * scale, 320.0 * scale)
                .logical(scale)
                .unwrap();
            let right = approval_rect(opener, work).unwrap();
            assert_eq!(right.x, opener.x + opener.width + 12.0);
            let edge = rect(-460.0, 900.0, 460.0, 320.0);
            let left = approval_rect(edge, work).unwrap();
            assert_eq!(left.x + left.width + 12.0, edge.x);
            assert_eq!(left.y + left.height, work.y + work.height);
        }
        let tiny_work = rect(20.0, 30.0, 320.0, 400.0);
        assert_eq!(
            approval_rect(rect(50.0, 50.0, 200.0, 300.0), tiny_work).unwrap(),
            tiny_work
        );
        assert!(approval_rect(rect(f64::INFINITY, 0.0, 100.0, 100.0), tiny_work).is_err());
        let full = approval_rect(
            rect(100.0, 100.0, 460.0, 320.0),
            rect(0.0, 0.0, 1920.0, 1080.0),
        )
        .unwrap();
        assert_eq!((full.width, full.height), APPROVAL_SIZE);
    }
    #[test]
    fn w8_placement_property_style_at_100_125_150_percent() {
        for scale in [1.0, 1.25, 1.5] {
            let work = rect(-1920.0 * scale, 0.0, 1920.0 * scale, 1080.0 * scale)
                .logical(scale)
                .unwrap();
            for x in [-1920.0, -1500.0, -500.0, -88.0] {
                for y in [0.0, 200.0, 800.0, 992.0] {
                    let anchor = rect(x * scale, y * scale, 88.0 * scale, 88.0 * scale)
                        .logical(scale)
                        .unwrap();
                    for form in [
                        Form::Rest,
                        Form::Tab,
                        Form::Ticker,
                        Form::Card,
                        Form::Stack,
                        Form::Handoff,
                        Form::Welcome,
                    ] {
                        let p = place(anchor, work, form).unwrap();
                        assert!(p.rect.x >= work.x && p.rect.y >= work.y);
                        assert!(p.rect.x + p.rect.width <= work.x + work.width);
                        assert!(p.rect.y + p.rect.height <= work.y + work.height);
                    }
                }
            }
        }
    }
    #[test]
    fn puck_anchor_survives_flips_and_resize() {
        let p = place(
            rect(912.0, 712.0, 88.0, 88.0),
            rect(0.0, 0.0, 1000.0, 800.0),
            Form::Card,
        )
        .unwrap();
        assert_eq!((p.side, p.valign), (Side::Left, VAlign::Up));
        assert_eq!(p.rect.x + p.rect.width, 1000.0);
        assert_eq!(p.rect.y + p.rect.height, 800.0);
    }
    #[test]
    fn w8_snap_scales_and_ignores_hidden_or_minimized_main() {
        for scale in [1.0, 1.25, 1.5] {
            let work = rect(0.0, 0.0, 1920.0 * scale, 1080.0 * scale)
                .logical(scale)
                .unwrap();
            let anchor = rect(1010.0 * scale, 200.0 * scale, 88.0 * scale, 88.0 * scale)
                .logical(scale)
                .unwrap();
            let main = rect(0.0, 0.0, 1000.0 * scale, 800.0 * scale)
                .logical(scale)
                .unwrap();
            assert_eq!(
                snap(anchor, work, Some(main)).unwrap().class,
                Snap::MainRight
            );
            assert_eq!(snap(anchor, work, None).unwrap().class, Snap::Free);
            assert_eq!(
                snap(rect(0.0, 200.0, 88.0, 88.0), work, None).unwrap().form,
                Form::Tab
            );
        }
    }
    #[test]
    fn invalid_geometry_never_panics_and_small_work_area_clamps() {
        assert!(rect(0.0, 0.0, 100.0, 100.0).logical(0.0).is_err());
        assert!(
            place(
                rect(f64::NAN, 0.0, 88.0, 88.0),
                rect(0.0, 0.0, 100.0, 100.0),
                Form::Card
            )
            .is_err()
        );
        let p = place(
            rect(1000.0, 1000.0, 88.0, 88.0),
            rect(0.0, 0.0, 100.0, 100.0),
            Form::Card,
        )
        .unwrap();
        assert_eq!(p.rect, rect(0.0, 0.0, 100.0, 100.0));
    }
}
