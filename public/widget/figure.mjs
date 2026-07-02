/**
 * The stick-figure rig shared by the widget and the walk sandbox.
 *
 * Joint groups nest so a parent rotation carries its children (hip carries
 * knee, shoulder carries elbow). The pivot points live in widget.css as
 * transform-origins and must match this geometry.
 *
 * The viewBox bottom edge (y=42) IS the standing feet: with xMidYMax the art
 * pins to the element's bottom edge, which the scene anchors on the ground
 * plane (--ts-ground-level), so the feet touch the ground line at any scale.
 */

/**
 * @param {string} [svgAttributes] Extra attributes for the root svg tag.
 * @returns {string}
 */
export function figureMarkup(svgAttributes = "") {
  return `
    <svg viewBox="0 0 20 42" preserveAspectRatio="xMidYMax meet" ${svgAttributes}>
      <g class="figure-core">
        <circle class="head" cx="10" cy="6.2" r="3.4"></circle>
        <line x1="10" y1="10" x2="10" y2="26"></line>
        <g class="joint arm-l">
          <line x1="9.4" y1="14" x2="6.1" y2="20"></line>
          <g class="joint elbow-l">
            <line x1="6.1" y1="20" x2="4.7" y2="26"></line>
          </g>
        </g>
        <g class="joint arm-r">
          <line x1="10.6" y1="14" x2="13.9" y2="20"></line>
          <g class="joint elbow-r">
            <line x1="13.9" y1="20" x2="15.3" y2="26"></line>
          </g>
        </g>
        <g class="joint leg-l">
          <line x1="9.2" y1="26" x2="7.1" y2="34"></line>
          <g class="joint knee-l">
            <line x1="7.1" y1="34" x2="5.4" y2="42"></line>
          </g>
        </g>
        <g class="joint leg-r">
          <line x1="10.8" y1="26" x2="12.9" y2="34"></line>
          <g class="joint knee-r">
            <line x1="12.9" y1="34" x2="14.6" y2="42"></line>
          </g>
        </g>
      </g>
    </svg>
  `;
}
