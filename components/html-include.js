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
