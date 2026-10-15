/*
	Minimal HTML include loader (purpose-built for this site; no dependencies).

	Usage in any page:
		<div data-include="/components/footer.html?v=1"></div>
		<script src="/components/html-include.js?v=1"></script>

	The loader finds every [data-include] element, fetches the URL in the
	attribute, and replaces the element (outerHTML) with the fetched markup.
	The value attribute carries its own cache-busting ?v= so updating the
	shared footer only requires bumping that version in each page.
*/
(function (window, document) {
	"use strict";

	/* The section menu (page-nav.html) is one shared fragment, so it
	   cannot know which page it is on. After it lands, mark the link
	   matching the URL's first path segment (about/gallery/services/
	   booking) with aria-current + .is-active so the CSS can fill it.
	   Pages outside those four sections (contact, terms, ...) simply
	   get no highlight. */
	function highlightPageNav() {
		var menu = document.querySelector(".page-menu");
		if (!menu) {
			return;
		}

		var segments = window.location.pathname.split("/").filter(String);
		if (segments.length === 0) {
			return;
		}

		var current = "/" + segments[0] + "/";
		var link = menu.querySelector('a[href="' + current + '"]');

		if (link) {
			link.setAttribute("aria-current", "page");
			link.classList.add("is-active");
		}
	}

	/* Placeholder attributes configure the bar wrapper the fragment
	   lands in: data-no-back drops the back link (confirmation pages),
	   data-back="..." reroutes it. Back link destinations otherwise stay
	   whatever each page's own markup sets (one level up). */
	function applyNavConfig(placeholder) {
		var backLink = document.querySelector(".page-back, .booking-page-back");
		var backHref = placeholder.getAttribute("data-back");

		if (placeholder.hasAttribute("data-no-back") && backLink) {
			backLink.remove();
		} else if (backHref && backLink) {
			backLink.setAttribute("href", backHref);
		}
	}

	function includeAll() {
		var placeholders = document.querySelectorAll("[data-include]");
		var pending = placeholders.length;

		if (pending === 0) {
			return;
		}

		Array.prototype.forEach.call(placeholders, function (el) {
			var url = el.getAttribute("data-include");

			fetch(url, { credentials: "same-origin" })
				.then(function (response) {
					if (!response.ok) {
						throw new Error("include failed: " + response.status + " " + url);
					}
					return response.text();
				})
				.then(function (html) {
					el.outerHTML = html;
					if (url.indexOf("page-nav") !== -1) {
						applyNavConfig(el);
						highlightPageNav();
					}
				})
				.catch(function (error) {
					// Leave the placeholder (empty div) in place; the page
					// simply renders without the included fragment.
					if (window.console && window.console.error) {
						window.console.error(error);
					}
				})
				.finally(function () {
					pending -= 1;
				});
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", includeAll);
	} else {
		includeAll();
	}
})(window, document);
