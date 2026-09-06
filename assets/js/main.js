/*
	Cyberflight Studios
	Site-wide JavaScript

	Originally based on Dimension by HTML5 UP
	html5up.net | @ajlkn
	CCA 3.0 license: html5up.net/license

	The original Dimension single-page article navigation has been removed.
	Cyberflight Studios now uses a multi-page structure with dedicated URLs
	for improved navigation, maintainability, and search engine indexing.
*/

(function () {

	'use strict';

	/*
	 * Responsive Breakpoints
	 *
	 * Retains the breakpoint configuration used by the Dimension layout
	 * and the site's existing responsive CSS.
	 */
	breakpoints({
		xlarge:  [ '1281px', '1680px' ],
		large:   [ '981px',  '1280px' ],
		medium:  [ '737px',  '980px' ],
		small:   [ '481px',  '736px' ],
		xsmall:  [ '361px',  '480px' ],
		xxsmall: [ null,     '360px' ]
	});


	/*
	 * Initial Page Animation
	 *
	 * Removes the preload class shortly after the DOM is ready,
	 * allowing the site's entrance animations to begin.
	 */
	document.addEventListener('DOMContentLoaded', function () {

		window.setTimeout(function () {
			document.body.classList.remove('is-preload');
		}, 100);

	});


	/*
	 * Navigation Alignment
	 *
	 * Preserves Dimension's centered navigation styling when the
	 * navigation contains an even number of menu items.
	 */
	document.addEventListener('DOMContentLoaded', function () {

		const nav = document.querySelector('#header nav');

		if (!nav)
			return;

		const navItems = nav.querySelectorAll('li');

		if (navItems.length > 0 && navItems.length % 2 === 0) {

			nav.classList.add('use-middle');

			navItems[navItems.length / 2].classList.add('is-middle');

		}

	});

})();