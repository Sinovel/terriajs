/**
 * This could use a lot of work, for example, due to the way both of:
 *  - how the component is currently composed
 *  - how it's currently hooked into the cesium viewer
 * we needlessly force re-render it all even though there is no change to orbit
 * or heading
 *
 * You'll also see a few weird numbers - this is due to the port from the scss
 * styles, and will be leaving it as is for now
 */
//

"use strict";
import React from "react";
import PropTypes from "prop-types";
import styled from "styled-components";
import CameraFlightPath from "terriajs-cesium/Source/Scene/CameraFlightPath";
import Cartesian2 from "terriajs-cesium/Source/Core/Cartesian2";
import Cartesian3 from "terriajs-cesium/Source/Core/Cartesian3";
import CesiumMath from "terriajs-cesium/Source/Core/Math";
import defined from "terriajs-cesium/Source/Core/defined";
import Ellipsoid from "terriajs-cesium/Source/Core/Ellipsoid";
import getTimestamp from "terriajs-cesium/Source/Core/getTimestamp";
import Matrix4 from "terriajs-cesium/Source/Core/Matrix4";
import Ray from "terriajs-cesium/Source/Core/Ray";
import Transforms from "terriajs-cesium/Source/Core/Transforms";
import Icon, { StyledIcon } from "../../Icon.jsx";
import GyroscopeGuidance from "../../GyroscopeGuidance/GyroscopeGuidance";
import { runInAction, computed, when } from "mobx";
import { withTranslation } from "react-i18next";
import { withTheme } from "styled-components";
import { withTerriaRef } from "../../HOCs/withTerriaRef";

import FadeIn from "../../Transitions/FadeIn/FadeIn";

// Map Compass
//
// Markup:
// <StyledCompass>
//   (<GyroscopeGuidance /> if hovered/active/focused)
//   <StyledCompassOuterRing /> (base, turns into white circle when active)
//   <StyledCompassOuterRing /> (clone to be used for animation)
//   <StyledCompassInnerRing title="Click and drag to rotate the camera" />
//   <StyledCompassRotationMarker />
// </StyledCompass>

const StyledCompass = styled.div`
  display: none;
  position: relative;

  width: ${props => props.theme.compassWidth}px;
  height: ${props => props.theme.compassWidth}px;

  @media (min-width: ${props => props.theme.sm}px) {
    display: block;
  }
`;

// 1.1818 comes from 65/55 = 1.1818 (64 and 56 sketch-designed numbers adapted for our "5" multiplier atm)
const compassScaleRatio = 65 / 55;

const StyledCompassOuterRing = styled.div`
  ${props => props.theme.centerWithoutFlex()}
  z-index: ${props => (props.active ? "2" : "1")};
  width: 100%;
  
  ${props =>
    props.active &&
    `transform: translate(-50%,-50%) scale(${compassScaleRatio});`};

  transition: transform 0.3s;
`;

const StyledCompassInnerRing = styled.div`
  ${props => props.theme.verticalAlign()}
  
  width: ${props =>
    Number(props.theme.compassWidth) - Number(props.theme.ringWidth) - 10}px;
  height: ${props =>
    Number(props.theme.compassWidth) - Number(props.theme.ringWidth) - 10}px;

  margin: 0 auto;
  padding: 4px;
  box-sizing: border-box;
`;

const StyledCompassRotationMarker = styled.div`
  ${props => props.theme.centerWithoutFlex()}
  z-index: 3;

  cursor: pointer;

  width: ${props =>
    Number(props.theme.compassWidth) + Number(props.theme.ringWidth) - 4}px;
  height: ${props =>
    Number(props.theme.compassWidth) + Number(props.theme.ringWidth) - 4}px;

  border-radius: 50%;
  background-repeat: no-repeat;
  background-size: contain;
`;

// the compass on map
class Compass extends React.Component {
  static propTypes = {
    terria: PropTypes.object,
    viewState: PropTypes.object,
    refFromHOC: PropTypes.object.isRequired,
    theme: PropTypes.object.isRequired,
    t: PropTypes.func.isRequired
  };

  /**
   * @param {Props} props
   */
  constructor(props) {
    super(props);
    this.state = {
      orbitCursorAngle: 0,
      heading: 0.0,
      orbitCursorOpacity: 0,
      active: false,
      activeForTransition: false
    };

    when(
      () => this.cesiumViewer,
      () => this.cesiumLoaded()
    );
  }

  @computed
  get cesiumViewer() {
    return this.props.terria.cesium;
  }

  cesiumLoaded() {
    this._unsubscribeFromViewerChange = this.props.terria.mainViewer.afterViewerChanged.addEventListener(
      () => viewerChange(this)
    );
    viewerChange(this);
  }

  componentWillUnmount() {
    document.removeEventListener(
      "mousemove",
      this.orbitMouseMoveFunction,
      false
    );
    document.removeEventListener("mouseup", this.orbitMouseUpFunction, false);
    this._unsubscribeFromAnimationFrame &&
      this._unsubscribeFromAnimationFrame();
    this._unsubscribeFromPostRender && this._unsubscribeFromPostRender();
    this._unsubscribeFromViewerChange && this._unsubscribeFromViewerChange();
  }

  handleMouseDown(e) {
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();

    const compassElement = e.currentTarget;
    const compassRectangle = e.currentTarget.getBoundingClientRect();
    const maxDistance = compassRectangle.width / 2.0;
    const center = new Cartesian2(
      (compassRectangle.right - compassRectangle.left) / 2.0,
      (compassRectangle.bottom - compassRectangle.top) / 2.0
    );
    const clickLocation = new Cartesian2(
      e.clientX - compassRectangle.left,
      e.clientY - compassRectangle.top
    );
    const vector = Cartesian2.subtract(clickLocation, center, vectorScratch);
    const distanceFromCenter = Cartesian2.magnitude(vector);

    const distanceFraction = distanceFromCenter / maxDistance;

    const nominalTotalRadius = 145;
    const norminalGyroRadius = 50;

    if (distanceFraction < norminalGyroRadius / nominalTotalRadius) {
      orbit(this, compassElement, vector);
    } else if (distanceFraction < 1.0) {
      rotate(this, compassElement, vector);
    } else {
      return true;
    }
  }

  handleDoubleClick(e) {
    const scene = this.props.terria.cesium.scene;
    const camera = scene.camera;

    const windowPosition = windowPositionScratch;
    windowPosition.x = scene.canvas.clientWidth / 2;
    windowPosition.y = scene.canvas.clientHeight / 2;
    const ray = camera.getPickRay(windowPosition, pickRayScratch);

    const center = scene.globe.pick(ray, scene, centerScratch);
    if (!defined(center)) {
      // Globe is barely visible, so reset to home view.
      this.props.terria.currentViewer.zoomTo(this.props.terria.homeView, 1.5);
      return;
    }

    const rotateFrame = Transforms.eastNorthUpToFixedFrame(
      center,
      Ellipsoid.WGS84
    );

    const lookVector = Cartesian3.subtract(
      center,
      camera.position,
      new Cartesian3()
    );

    const flight = CameraFlightPath.createTween(scene, {
      destination: Matrix4.multiplyByPoint(
        rotateFrame,
        new Cartesian3(0.0, 0.0, Cartesian3.magnitude(lookVector)),
        new Cartesian3()
      ),
      direction: Matrix4.multiplyByPointAsVector(
        rotateFrame,
        new Cartesian3(0.0, 0.0, -1.0),
        new Cartesian3()
      ),
      up: Matrix4.multiplyByPointAsVector(
        rotateFrame,
        new Cartesian3(0.0, 1.0, 0.0),
        new Cartesian3()
      ),
      duration: 1.5
    });
    scene.tweens.add(flight);
  }

  resetRotater() {
    this.setState({
      orbitCursorOpacity: 0,
      orbitCursorAngle: 0
    });
  }

  render() {
    const rotationMarkerStyle = {
      transform: "rotate(-" + this.state.orbitCursorAngle + "rad)",
      WebkitTransform: "rotate(-" + this.state.orbitCursorAngle + "rad)",
      opacity: this.state.orbitCursorOpacity
    };

    const outerCircleStyle = {
      transform: "rotate(-" + this.state.heading + "rad)",
      WebkitTransform: "rotate(-" + this.state.heading + "rad)",
      opacity: ""
    };
    const { t } = this.props;
    const active = this.state.active;
    const description = t("compass.description");

    return (
      <StyledCompass
        onMouseDown={this.handleMouseDown.bind(this)}
        onDoubleClick={this.handleDoubleClick.bind(this)}
        onMouseUp={this.resetRotater.bind(this)}
        active={active}
      >
        {/* Bottom "turns into white circle when active" layer */}
        <StyledCompassOuterRing active={false}>
          <div style={outerCircleStyle}>
            <StyledIcon
              fillColor={this.props.theme.textDarker}
              // if it's active, show a white circle only, as we need the base layer
              glyph={
                active
                  ? Icon.GLYPHS.compassOuterSkeleton
                  : Icon.GLYPHS.compassOuter
              }
            />
          </div>
        </StyledCompassOuterRing>

        {/* "Top" animated layer */}
        <StyledCompassOuterRing
          active={active}
          title={description}
          aria-hidden="true"
          role="presentation"
        >
          <div ref={this.props.refFromHOC} style={outerCircleStyle}>
            <StyledIcon
              fillColor={this.props.theme.textDarker}
              glyph={Icon.GLYPHS.compassOuter}
            />
          </div>
        </StyledCompassOuterRing>

        {/* "Center circle icon" */}
        <StyledCompassInnerRing title={t("compass.title")}>
          <StyledIcon
            fillColor={this.props.theme.textDarker}
            glyph={
              active ? Icon.GLYPHS.compassInnerArrows : Icon.GLYPHS.compassInner
            }
          />
        </StyledCompassInnerRing>

        {/* Rotation marker when dragging */}
        <StyledCompassRotationMarker
          title={description}
          style={{
            backgroundImage: require("../../../../wwwroot/images/compass-rotation-marker.svg")
          }}
          onMouseOver={() => this.setState({ active: true })}
          onMouseOut={() => this.setState({ active: true })}
          // do we give focus to this? given it's purely a mouse tool
          // focus it anyway..
          tabIndex="0"
          onFocus={() => this.setState({ active: true })}
          // Gotta keep menu open if blurred, and close it with the close button
          // instead. otherwise it'll never focus on the help buttons
          // onBlur={() => this.setState({ active: false })}
        >
          <div style={rotationMarkerStyle}>
            <StyledIcon
              fillColor={this.props.theme.textDarker}
              glyph={Icon.GLYPHS.compassRotationMarker}
            />
          </div>
        </StyledCompassRotationMarker>

        {/* Gyroscope guidance menu */}
        <FadeIn isVisible={active}>
          <GyroscopeGuidance
            viewState={this.props.viewState}
            handleHelp={() => {
              this.props.viewState.showHelpPanel();
              this.props.viewState.selectHelpMenuItem("navigation");
            }}
            onClose={() => this.setState({ active: false })}
          />
        </FadeIn>
      </StyledCompass>
    );
  }
}

const vectorScratch = new Cartesian2();
const oldTransformScratch = new Matrix4();
const newTransformScratch = new Matrix4();
const centerScratch = new Cartesian3();
const windowPositionScratch = new Cartesian2();
const pickRayScratch = new Ray();

function rotate(viewModel, compassElement, cursorVector) {
  // Remove existing event handlers, if any.
  document.removeEventListener(
    "mousemove",
    viewModel.rotateMouseMoveFunction,
    false
  );
  document.removeEventListener(
    "mouseup",
    viewModel.rotateMouseUpFunction,
    false
  );

  viewModel.rotateMouseMoveFunction = undefined;
  viewModel.rotateMouseUpFunction = undefined;

  viewModel.isRotating = true;
  viewModel.rotateInitialCursorAngle = Math.atan2(
    -cursorVector.y,
    cursorVector.x
  );

  const scene = viewModel.props.terria.cesium.scene;
  let camera = scene.camera;
  const windowPosition = windowPositionScratch;
  windowPosition.x = scene.canvas.clientWidth / 2;
  windowPosition.y = scene.canvas.clientHeight / 2;
  const ray = camera.getPickRay(windowPosition, pickRayScratch);

  const viewCenter = scene.globe.pick(ray, scene, centerScratch);
  if (!defined(viewCenter)) {
    viewModel.rotateFrame = Transforms.eastNorthUpToFixedFrame(
      camera.positionWC,
      Ellipsoid.WGS84,
      newTransformScratch
    );
    viewModel.rotateIsLook = true;
  } else {
    viewModel.rotateFrame = Transforms.eastNorthUpToFixedFrame(
      viewCenter,
      Ellipsoid.WGS84,
      newTransformScratch
    );
    viewModel.rotateIsLook = false;
  }

  let oldTransform = Matrix4.clone(camera.transform, oldTransformScratch);
  camera.lookAtTransform(viewModel.rotateFrame);
  viewModel.rotateInitialCameraAngle = Math.atan2(
    camera.position.y,
    camera.position.x
  );
  viewModel.rotateInitialCameraDistance = Cartesian3.magnitude(
    new Cartesian3(camera.position.x, camera.position.y, 0.0)
  );
  camera.lookAtTransform(oldTransform);

  viewModel.rotateMouseMoveFunction = function(e) {
    const compassRectangle = compassElement.getBoundingClientRect();
    const center = new Cartesian2(
      (compassRectangle.right - compassRectangle.left) / 2.0,
      (compassRectangle.bottom - compassRectangle.top) / 2.0
    );
    const clickLocation = new Cartesian2(
      e.clientX - compassRectangle.left,
      e.clientY - compassRectangle.top
    );
    const vector = Cartesian2.subtract(clickLocation, center, vectorScratch);
    const angle = Math.atan2(-vector.y, vector.x);

    const angleDifference = angle - viewModel.rotateInitialCursorAngle;
    const newCameraAngle = CesiumMath.zeroToTwoPi(
      viewModel.rotateInitialCameraAngle - angleDifference
    );

    camera = viewModel.props.terria.cesium.scene.camera;

    oldTransform = Matrix4.clone(camera.transform, oldTransformScratch);
    camera.lookAtTransform(viewModel.rotateFrame);
    const currentCameraAngle = Math.atan2(camera.position.y, camera.position.x);
    camera.rotateRight(newCameraAngle - currentCameraAngle);
    camera.lookAtTransform(oldTransform);

    // viewModel.props.terria.cesium.notifyRepaintRequired();
  };

  viewModel.rotateMouseUpFunction = function(e) {
    viewModel.isRotating = false;
    document.removeEventListener(
      "mousemove",
      viewModel.rotateMouseMoveFunction,
      false
    );
    document.removeEventListener(
      "mouseup",
      viewModel.rotateMouseUpFunction,
      false
    );

    viewModel.rotateMouseMoveFunction = undefined;
    viewModel.rotateMouseUpFunction = undefined;
  };

  document.addEventListener(
    "mousemove",
    viewModel.rotateMouseMoveFunction,
    false
  );
  document.addEventListener("mouseup", viewModel.rotateMouseUpFunction, false);
}

function orbit(viewModel, compassElement, cursorVector) {
  // Remove existing event handlers, if any.
  document.removeEventListener(
    "mousemove",
    viewModel.orbitMouseMoveFunction,
    false
  );
  document.removeEventListener(
    "mouseup",
    viewModel.orbitMouseUpFunction,
    false
  );

  viewModel._unsubscribeFromAnimationFrame &&
    viewModel._unsubscribeFromAnimationFrame();
  viewModel._unsubscribeFromAnimationFrame = undefined;

  viewModel.orbitMouseMoveFunction = undefined;
  viewModel.orbitMouseUpFunction = undefined;
  viewModel.orbitAnimationFrameFunction = undefined;

  viewModel.isOrbiting = true;
  viewModel.orbitLastTimestamp = getTimestamp();

  let scene = viewModel.props.terria.cesium.scene;
  let camera = scene.camera;

  const windowPosition = windowPositionScratch;
  windowPosition.x = scene.canvas.clientWidth / 2;
  windowPosition.y = scene.canvas.clientHeight / 2;
  const ray = camera.getPickRay(windowPosition, pickRayScratch);

  let center = scene.globe.pick(ray, scene, centerScratch);
  if (!defined(center)) {
    viewModel.orbitFrame = Transforms.eastNorthUpToFixedFrame(
      camera.positionWC,
      Ellipsoid.WGS84,
      newTransformScratch
    );
    viewModel.orbitIsLook = true;
  } else {
    viewModel.orbitFrame = Transforms.eastNorthUpToFixedFrame(
      center,
      Ellipsoid.WGS84,
      newTransformScratch
    );
    viewModel.orbitIsLook = false;
  }

  viewModel.orbitAnimationFrameFunction = function(e) {
    const timestamp = getTimestamp();
    const deltaT = timestamp - viewModel.orbitLastTimestamp;
    const rate = ((viewModel.state.orbitCursorOpacity - 0.5) * 2.5) / 1000;
    const distance = deltaT * rate;

    const angle = viewModel.state.orbitCursorAngle + CesiumMath.PI_OVER_TWO;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;

    scene = viewModel.props.terria.cesium.scene;
    camera = scene.camera;

    const oldTransform = Matrix4.clone(camera.transform, oldTransformScratch);

    camera.lookAtTransform(viewModel.orbitFrame);

    if (viewModel.orbitIsLook) {
      camera.look(Cartesian3.UNIT_Z, -x);
      camera.look(camera.right, -y);
    } else {
      camera.rotateLeft(x);
      camera.rotateUp(y);
    }

    camera.lookAtTransform(oldTransform);

    // viewModel.props.terria.cesium.notifyRepaintRequired();

    viewModel.orbitLastTimestamp = timestamp;
  };

  function updateAngleAndOpacity(vector, compassWidth) {
    const angle = Math.atan2(-vector.y, vector.x);
    viewModel.setState({
      orbitCursorAngle: CesiumMath.zeroToTwoPi(angle - CesiumMath.PI_OVER_TWO)
    });

    const distance = Cartesian2.magnitude(vector);
    const maxDistance = compassWidth / 2.0;
    const distanceFraction = Math.min(distance / maxDistance, 1.0);
    const easedOpacity = 0.5 * distanceFraction * distanceFraction + 0.5;
    viewModel.setState({
      orbitCursorOpacity: easedOpacity
    });

    // viewModel.props.terria.cesium.notifyRepaintRequired();
  }

  viewModel.orbitMouseMoveFunction = function(e) {
    const compassRectangle = compassElement.getBoundingClientRect();
    center = new Cartesian2(
      (compassRectangle.right - compassRectangle.left) / 2.0,
      (compassRectangle.bottom - compassRectangle.top) / 2.0
    );
    const clickLocation = new Cartesian2(
      e.clientX - compassRectangle.left,
      e.clientY - compassRectangle.top
    );
    const vector = Cartesian2.subtract(clickLocation, center, vectorScratch);
    updateAngleAndOpacity(vector, compassRectangle.width);
  };

  viewModel.orbitMouseUpFunction = function(e) {
    // TODO: if mouse didn't move, reset view to looking down, north is up?

    viewModel.isOrbiting = false;
    document.removeEventListener(
      "mousemove",
      viewModel.orbitMouseMoveFunction,
      false
    );
    document.removeEventListener(
      "mouseup",
      viewModel.orbitMouseUpFunction,
      false
    );

    this._unsubscribeFromAnimationFrame &&
      this._unsubscribeFromAnimationFrame();
    this._unsubscribeFromAnimationFrame = undefined;

    viewModel.orbitMouseMoveFunction = undefined;
    viewModel.orbitMouseUpFunction = undefined;
    viewModel.orbitAnimationFrameFunction = undefined;
  };

  document.addEventListener(
    "mousemove",
    viewModel.orbitMouseMoveFunction,
    false
  );
  document.addEventListener("mouseup", viewModel.orbitMouseUpFunction, false);

  subscribeToAnimationFrame(viewModel);

  updateAngleAndOpacity(
    cursorVector,
    compassElement.getBoundingClientRect().width
  );
}

function subscribeToAnimationFrame(viewModel) {
  viewModel._unsubscribeFromAnimationFrame = (id => () =>
    cancelAnimationFrame(id))(
    requestAnimationFrame(() => {
      if (defined(viewModel.orbitAnimationFrameFunction)) {
        viewModel.orbitAnimationFrameFunction();
      }
      subscribeToAnimationFrame(viewModel);
    })
  );
}

function viewerChange(viewModel) {
  runInAction(() => {
    if (defined(viewModel.props.terria.cesium)) {
      if (viewModel._unsubscribeFromPostRender) {
        viewModel._unsubscribeFromPostRender();
        viewModel._unsubscribeFromPostRender = undefined;
      }

      viewModel._unsubscribeFromPostRender = viewModel.props.terria.cesium.scene.postRender.addEventListener(
        function() {
          runInAction(() => {
            viewModel.setState({
              heading: viewModel.props.terria.cesium.scene.camera.heading
            });
          });
        }
      );
    } else {
      if (viewModel._unsubscribeFromPostRender) {
        viewModel._unsubscribeFromPostRender();
        viewModel._unsubscribeFromPostRender = undefined;
      }
      viewModel.showCompass = false;
    }
  });
}

export const COMPASS_NAME = "MapNavigationCompassOuterRing";
export default withTranslation()(
  withTheme(withTerriaRef(Compass, COMPASS_NAME))
);
