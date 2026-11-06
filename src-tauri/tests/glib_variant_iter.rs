#![cfg(target_os = "linux")]

// Exercise the same GLib instance used by GTK/Tauri, including optimized builds.
use gtk::glib::{variant::ToVariant, Variant};

#[test]
fn forward_reverse_and_last_preserve_strings() {
    let long = "长字符串🦀".repeat(1024);
    let values = ["", "ASCII", "设备共享", "🦀", long.as_str()];
    let variant = values.to_variant();
    assert_eq!(
        variant.array_iter_str().unwrap().collect::<Vec<_>>(),
        values
    );
    assert_eq!(
        variant.array_iter_str().unwrap().rev().collect::<Vec<_>>(),
        values.into_iter().rev().collect::<Vec<_>>()
    );
    assert_eq!(
        variant.array_iter_str().unwrap().last(),
        Some(long.as_str())
    );
}

#[test]
fn mixed_ends_and_skipping_use_the_output_pointer() {
    let variant = ["零", "one", "", "three", "四", "🦀"].to_variant();
    let mut iter = variant.array_iter_str().unwrap();
    assert_eq!(iter.size_hint(), (6, Some(6)));
    assert_eq!(iter.next(), Some("零"));
    assert_eq!(iter.next_back(), Some("🦀"));
    assert_eq!(iter.nth(1), Some(""));
    assert_eq!(iter.len(), 2);
    assert_eq!(iter.nth_back(1), Some("three"));
    assert_eq!(iter.len(), 0);
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next_back(), None);
}

#[test]
fn empty_exhausted_and_overflowing_iterators_are_fused() {
    let variant = Vec::<String>::new().to_variant();
    let mut empty = variant.array_iter_str().unwrap();
    assert_eq!(empty.len(), 0);
    assert_eq!(empty.next(), None);
    assert_eq!(empty.next_back(), None);

    let variant = ["only"].to_variant();
    let mut iter = variant.array_iter_str().unwrap();
    assert_eq!(iter.next_back(), Some("only"));
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next_back(), None);

    let mut iter = variant.array_iter_str().unwrap();
    assert_eq!(iter.nth(usize::MAX), None);
    assert_eq!(iter.next_back(), None);
    let mut iter = variant.array_iter_str().unwrap();
    assert_eq!(iter.nth_back(usize::MAX), None);
    assert_eq!(iter.next(), None);

    assert!(Variant::from(123i32).array_iter_str().is_err());
}
