"use strict";

document.addEventListener("DOMContentLoaded", () => {
  // Set the reviews scroll speed based on the available width
  const reviewsTrack = document.querySelector(".reviews-track");
  const reviewsGroup = reviewsTrack?.querySelector(".reviews-group");

  if (reviewsTrack && reviewsGroup) {
    const reviewScrollSpeed = 50;
    let previousWidth = 0;

    const updateReviewsSpeed = () => {
      const width = reviewsGroup.getBoundingClientRect().width;

      if (width && Math.abs(width - previousWidth) > 0.5) {
        reviewsTrack.style.setProperty("--reviews-duration", `${width / reviewScrollSpeed}s`);
        previousWidth = width;
      }
    };

    updateReviewsSpeed();

    // Listen to resize events to update the scroll speed if the width changes
    if ("ResizeObserver" in window) {
      new ResizeObserver(updateReviewsSpeed).observe(reviewsGroup);
    } else {
      window.addEventListener("resize", updateReviewsSpeed);
    }
  }

  // Mobile nav
  const toggle = document.getElementById("navToggle");
  const nav = document.getElementById("mainNav");

  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      toggle.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
    });

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        nav.classList.remove("is-open");
        toggle.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // Scroll reveals
  const revealElements = document.querySelectorAll(".reveal");

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      }),
      { threshold: 0.12 }
    );

    revealElements.forEach((element) => io.observe(element));
  } else {
    revealElements.forEach((element) => element.classList.add("is-visible"));
  }

  // Footer year
  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
});
