
"use strict";

/*global require,L,URI,$,Document,alert,console*/
var AssociativeArray = require('../third_party/cesium/Source/Core/AssociativeArray');
var Cartesian2 = require('../third_party/cesium/Source/Core/Cartesian2');
var Cartesian3 = require('../third_party/cesium/Source/Core/Cartesian3');
var Color = require('../third_party/cesium/Source/Core/Color');
var defined = require('../third_party/cesium/Source/Core/defined');
var destroyObject = require('../third_party/cesium/Source/Core/destroyObject');
var DeveloperError = require('../third_party/cesium/Source/Core/DeveloperError');
var Property = require('../third_party/cesium/Source/DataSources/Property');
var Ellipsoid = require('../third_party/cesium/Source/Core/Ellipsoid');
var CesiumMath = require('../third_party/cesium/Source/Core/Math');
var loadImage = require('../third_party/cesium/Source/Core/loadImage');
 

var defaultColor = Color.WHITE;
var defaultOutlineColor = Color.BLACK;
var defaultOutlineWidth = 1.0;
var defaultPixelSize = 5.0;

var defaultWidth = 5.0;


/**
 * A {@link Visualizer} which maps {@link Entity#point} to a {@link Billboard}.
 * @alias LeafletGeomVisualizer
 * @constructor
 *
 * @param {Scene} map The map the primitives will be rendered in.
 * @param {EntityCollection} entityCollection The entityCollection to visualize.
 */
var LeafletGeomVisualizer = function(map, entityCollection) {
    //>>includeStart('debug', pragmas.debug);
    if (!defined(map)) {
        throw new DeveloperError('map is required.');
    }
    if (!defined(entityCollection)) {
        throw new DeveloperError('entityCollection is required.');
    }
    //>>includeEnd('debug');

    console.log('leaflet-point-visualizer');

    var featureGroup = L.featureGroup().addTo(map);
    entityCollection.collectionChanged.addEventListener(LeafletGeomVisualizer.prototype._onCollectionChanged, this);

    this._map = map;
    this._featureGroup = featureGroup;
    this._entityCollection = entityCollection;
    this._entitiesToVisualize = new AssociativeArray();

    this._onCollectionChanged(entityCollection, entityCollection.entities, [], []);
};


LeafletGeomVisualizer.prototype._onCollectionChanged = function(entityCollection, added, removed, changed) {
    var i;
    var entity;
    var featureGroup = this._featureGroup;
    var entities = this._entitiesToVisualize;

    for (i = added.length - 1; i > -1; i--) {
        entity = added[i];
        if (((defined(entity._point) || defined(entity._billboard) || defined(entity._label)) && entity._position)
            || defined(entity._polyline) || defined(entity._polygon) ) {
            entities.set(entity.id, entity);
        }
    }

    for (i = changed.length - 1; i > -1; i--) {
        entity = changed[i];
        if (((defined(entity._point) || defined(entity._billboard) || defined(entity._label)) && entity._position)
            || defined(entity._polyline) || defined(entity._polygon) ) {
            entities.set(entity.id, entity);
        } else {
            cleanEntity(entity, featureGroup);
            entities.remove(entity.id);
        }
    }

    for (i = removed.length - 1; i > -1; i--) {
        entity = removed[i];
        cleanEntity(entity, featureGroup);
        entities.remove(entity.id);
    }
};

function cleanEntity(entity, group) {
    var geomLayer = entity._geomLayer;
    if (defined(geomLayer)) {
        group.removeLayer(geomLayer);
    }
}


/**
 * Updates the primitives created by this visualizer to match their
 * Entity counterpart at the given time.
 *
 * @param {JulianDate} time The time to update to.
 * @returns {Boolean} This function always returns true.
 */
LeafletGeomVisualizer.prototype.update = function(time) {
    //>>includeStart('debug', pragmas.debug);
    if (!defined(time)) {
        throw new DeveloperError('time is required.');
    }
    //>>includeEnd('debug');

    var entities = this._entitiesToVisualize.values;
    for (var i = 0, len = entities.length; i < len; i++) {
        var entity = entities[i];
        if (defined(entity._point)) {
            this.updatePoint(entity, time);
        }
        if (defined(entity._billboard)) {
            this.updateBillboard(entity, time);
        }
        if (defined(entity._label)) {
            this.updateLabel(entity, time);
        }
        if (defined(entity._polyline)) {
            this.updatePolyline(entity, time);
        }
        if (defined(entity._polygon)) {
            this.updatePolygon(entity, time);
        }
    }
    return true;
};

LeafletGeomVisualizer.prototype.updatePoint = function(entity, time) {
    var pointGraphics = entity._point;
    var featureGroup = this._featureGroup;
    var geomLayer = entity._geomPoint;
    var position;
    var show = entity.isAvailable(time) && Property.getValueOrDefault(pointGraphics._show, time, true);
    if (show) {
        position = Property.getValueOrUndefined(entity._position, time);
        show = defined(position);
    }
    if (!show) {
        cleanEntity(entity, featureGroup);
        return;
    }

    var cart = Ellipsoid.WGS84.cartesianToCartographic(position);
    var latlng = L.latLng( CesiumMath.toDegrees(cart.latitude), CesiumMath.toDegrees(cart.longitude) );
    var pixelSize = Property.getValueOrDefault(pointGraphics._pixelSize, time, defaultPixelSize);
    var color = Property.getValueOrDefault(pointGraphics._color, time, defaultColor);
    var outlineColor = Property.getValueOrDefault(pointGraphics._outlineColor, time, defaultOutlineColor);
    var outlineWidth = Property.getValueOrDefault(pointGraphics._outlineWidth, time, defaultOutlineWidth);

    var pointOptions = {
        radius: pixelSize / 2.0,
        fillColor: color.toCssColorString(),
        fillOpacity: color.alpha,
        color: outlineColor.toCssColorString(),
        weight: outlineWidth,
        opacity: outlineColor.alpha
    };

    if (!defined(geomLayer)) {
        var point = L.circleMarker(latlng, pointOptions);
        featureGroup.addLayer(point);
        entity._geomPoint = point;
    } else {
        var point = geomLayer;
        if (!point._latlng.equals(latlng)) {
            point.setLatLng(latlng);
        }
        for (var prop in pointOptions) {
            if (pointOptions[prop] !== point.options[prop]) {
                point.setStyle(markerOptions);
                break;
            }
        }
    }
}

//Recolor an image using 2d canvas
function recolorBillboard(img, color) {
    var canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;

    // Copy the image contents to the canvas
    var context = canvas.getContext("2d");
    context.drawImage(img, 0, 0);
    var image = context.getImageData(0, 0, canvas.width, canvas.height);
    var normClr = [color.red, color.green, color.blue, color.alpha];

    var length = image.data.length;  //pixel count * 4
    for (var i = 0; i < length; i += 4) {
        for (var j = 0; j < 4; j++) {
            image.data[j+i] *= normClr[j];
        }
    }
    
    context.putImageData(image, 0, 0);
    return canvas.toDataURL();
//    return context.getImageData(0, 0, canvas.width, canvas.height);
}

//Single pixel black dot
var tmpImage = "data:image/gif;base64,R0lGODlhAQABAPAAAAAAAP///yH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==";

//TODO: currently skipping all the distance related properties
LeafletGeomVisualizer.prototype.updateBillboard = function(entity, time) {
    var markerGraphics = entity._billboard;
    var featureGroup = this._featureGroup;
    var geomLayer = entity._geomBillboard;
    var position;
    var show = entity.isAvailable(time) && Property.getValueOrDefault(markerGraphics._show, time, true);
    if (show) {
        position = Property.getValueOrUndefined(entity._position, time);
        show = defined(position);
    }
    if (!show) {
        cleanEntity(entity, featureGroup);
        return;
    }

    var cart = Ellipsoid.WGS84.cartesianToCartographic(position);
    var latlng = L.latLng( CesiumMath.toDegrees(cart.latitude), CesiumMath.toDegrees(cart.longitude) );
    var imageUrl = Property.getValueOrDefault(markerGraphics._image, time, undefined);
    var height = Property.getValueOrDefault(markerGraphics._height, time, undefined);
    var width = Property.getValueOrDefault(markerGraphics._width, time, undefined);
    var color = Property.getValueOrDefault(markerGraphics._color, time, defaultColor);
    var scale = Property.getValueOrDefault(markerGraphics._scale, time, 1.0);
    var verticalOrigin = Property.getValueOrDefault(markerGraphics._verticalOrigin, time, undefined);
    var horizontalOrigin = Property.getValueOrDefault(markerGraphics._horizontalOrigin, time, undefined);
    var pixelOffset = Property.getValueOrDefault(markerGraphics._pixelOffset, time, new Cartesian2(0,0));

    var iconOptions = {
        color: color.toCssColorString(),
        origUrl: imageUrl,
        scale: scale,
        horizontalOrigin: horizontalOrigin,  //value: left, center, right
        verticalOrigin: verticalOrigin      //value: bottom, center, top
    };

    if (defined(height) || defined(width)) {
        iconOptions.iconSize = [width, height];
    }

    var redrawIcon = false;
    if (!defined(geomLayer)) {
        var marker = L.marker(latlng, {icon: L.icon({iconUrl: tmpImage})});
        featureGroup.addLayer(marker);
        entity._geomBillboard = marker;
        redrawIcon = true;
    } else {
        var marker = geomLayer;
        if (!marker._latlng.equals(latlng)) {
            marker.setLatLng(latlng);
        }
        for (var prop in iconOptions) {
            if (iconOptions[prop] !== marker.options.icon.options[prop]) {
                redrawIcon = true;
                break;
            }
        }
    }

    if (redrawIcon) {
        var drawBillboard = function(image, dataurl) {
            iconOptions.iconUrl = dataurl || image;
            if (!defined(iconOptions.iconSize)) {
                iconOptions.iconSize = [image.width * scale, image.height * scale];
            }
            //TODO: verify this against datasets
            var w = iconOptions.iconSize[0], h = iconOptions.iconSize[1];
            var xOff = (w/2)*(1+horizontalOrigin) + pixelOffset.x;
            var yOff = (h/2)*(1+verticalOrigin) + pixelOffset.y;
            iconOptions.iconAnchor = [xOff, yOff];

            if (!color.equals(defaultColor)) {
                iconOptions.iconUrl = recolorBillboard(image, color);
            }
            marker.setIcon(L.icon(iconOptions));
        };
        if (imageUrl.indexOf('data:image') === 0) {
            var img = new Image();
            img.onload = function() {
                drawBillboard(img, imageUrl);
            };
            img.src = imageUrl;
        } else {
            loadImage(imageUrl).then(function(img) { drawBillboard(img); });
        }
    }
}


LeafletGeomVisualizer.prototype.updateLabel = function(entity, time) {
    var labelGraphics = entity._label;
    var featureGroup = this._featureGroup;
    var geomLayer = entity._geomLabel;
    var position;
    var show = entity.isAvailable(time) && Property.getValueOrDefault(labelGraphics._show, time, true);
    if (show) {
        position = Property.getValueOrUndefined(entity._position, time);
        show = defined(position);
    }
    if (!show) {
        cleanEntity(entity, featureGroup);
        return;
    }

    var cart = Ellipsoid.WGS84.cartesianToCartographic(position);
    var latlng = L.latLng( CesiumMath.toDegrees(cart.latitude), CesiumMath.toDegrees(cart.longitude) );
    var text = Property.getValueOrDefault(labelGraphics._text, time, undefined);
    var font = Property.getValueOrDefault(labelGraphics._font, time, undefined);
    var scale = Property.getValueOrDefault(labelGraphics._scale, time, 1.0);
    var color = Property.getValueOrDefault(labelGraphics._fillColor, time, defaultColor);
    var verticalOrigin = Property.getValueOrDefault(labelGraphics._verticalOrigin, time, undefined);
    var horizontalOrigin = Property.getValueOrDefault(labelGraphics._horizontalOrigin, time, undefined);
    var pixelOffset = Property.getValueOrDefault(labelGraphics._pixelOffset, time, undefined);

    var color = 'color:'+color.toCssColorString() + ';';
    var font = defined(font) ? 'font-family:'+font + ';' : '';
    var size = 'font-size:'+ Math.round(scale*12) + 'px;';
    var align = defined(horizontalOrigin) ? 'text-align:center;' : '';
    var valign = defined(verticalOrigin) ? 'vertical-align:bottom;' : '';
    var hOff = defined(pixelOffset) ? 'margin-left:'+pixelOffset[0]+'px;' : '';
    var vOff = defined(pixelOffset) ? 'margin-top:'+pixelOffset[1]+'px;' : '';

    var style = color + font + size + align + valign + hOff + vOff;

    //TODO: verify against datasets
    var divIconOptions = {
        html: '<p style="'+style+'">'+text+'</p>',
        iconSize: [0, 0]
    };

    if (defined(pixelOffset)) {
        divIconOptions.iconAnchor = [-pixelOffset.x, -pixelOffset.y];
    }

    if (!defined(geomLayer)) {
        var markerOptions = { icon: L.divIcon(divIconOptions) };
        var marker = L.marker(latlng, markerOptions);
        featureGroup.addLayer(marker);
        entity._geomLabel = marker;
    } else {
        var marker = geomLayer;
        if (!marker._latlng.equals(latlng)) {
            marker.setLatLng(latlng);
        }
        for (var prop in divIconOptions) {
            if (divIconOptions[prop] !== marker.options.icon.options[prop]) {
                marker.setIcon(L.divIcon(divIconOptions));
                break;
            }
        }
    }
}

LeafletGeomVisualizer.prototype.updatePolyline = function(entity, time) {
    var polylineGraphics = entity._polyline;
    var featureGroup = this._featureGroup;
    var geomLayer = entity._geomLayer;
    var positions;
    var show = entity.isAvailable(time) && Property.getValueOrDefault(polylineGraphics._show, time, true);
    if (show) {
        positions = Property.getValueOrUndefined(polylineGraphics._positions, time);
        show = defined(positions);
    }
    if (!show) {
        cleanEntity(entity, featureGroup);
        return;
    }

    var carts = Ellipsoid.WGS84.cartesianArrayToCartographicArray(positions);
    var latlngs = [];
    for (var i = 0; i < carts.length; i++) {
        latlngs.push(L.latLng( CesiumMath.toDegrees(carts[i].latitude), CesiumMath.toDegrees(carts[i].longitude)));
    }
    var color = Property.getValueOrDefault(polylineGraphics._material.color, time, defaultColor);
    var width = Property.getValueOrDefault(polylineGraphics._width, time, defaultWidth);

    var polylineOptions = {
        color: color.toCssColorString(),
        weight: width,
        opacity: color.alpha
    };

    if (!defined(geomLayer)) {
        var polyline = L.polyline(latlngs, polylineOptions);
        featureGroup.addLayer(polyline);
        entity._geomLayer = polyline;
    } else {
        var polyline = geomLayer;
        var curLatLngs = polyline.getLatLngs;
        for (var i = 0; i < curLatLngs.length; i++) {
            if (!curLatLngs[i].equals(latlng[i])) {
                polyline.setLatLngs(latlngs);
                break;
            }
        }
        for (var prop in polylineOptions) {
            if (polylineOptions[prop] !== polyline.options[prop]) {
                polyline.setStyle(polylineOptions);
                break;
            }
        }
    }
}

LeafletGeomVisualizer.prototype.updatePolygon = function(entity, time) {
    var polygonGraphics = entity._polygon;
    var featureGroup = this._featureGroup;
    var geomLayer = entity._geomLayer;
    var positions;
    var show = entity.isAvailable(time) && Property.getValueOrDefault(polygonGraphics._show, time, true);
    if (show) {
        positions = Property.getValueOrUndefined(polygonGraphics._positions, time);
        show = defined(positions);
    }
    if (!show) {
        cleanEntity(entity, featureGroup);
        return;
    }

    var carts = Ellipsoid.WGS84.cartesianArrayToCartographicArray(positions);
    var latlngs = [];
    for (var i = 0; i < carts.length; i++) {
        latlngs.push(L.latLng( CesiumMath.toDegrees(carts[i].latitude), CesiumMath.toDegrees(carts[i].longitude)));
    }
    var color = Property.getValueOrDefault(polygonGraphics._material.color, time, defaultColor);
    var fill = Property.getValueOrDefault(polygonGraphics._fill, time, true);
    var outline = Property.getValueOrDefault(polygonGraphics._outline, time, true);
    var outlineColor = Property.getValueOrDefault(pointGraphics._outlineColor, time, defaultOutlineColor);

    var polygonOptions = {
        fill: fill,
        fillColor: color.toCssColorString(),
        fillOpacity: color.alpha,
        weight: outline ? 1.0 : 0.0,
        color: outlineColor.toCssColorString(),
        opacity: outlineColor.alpha
     };

    if (!defined(geomLayer)) {
        var polygon = L.polygon(latlngs, polygonOptions);
        featureGroup.addLayer(polygon);
        entity._geomLayer = polygon;
    } else {
        var polygon = geomLayer;
        var curLatLngs = polygon.getLatLngs;
        for (var i = 0; i < curLatLngs.length; i++) {
            if (!curLatLngs[i].equals(latlng[i])) {
                polygon.setLatLngs(latlngs);
                break;
            }
        }
        for (var prop in polygonOptions) {
            if (polygonOptions[prop] !== polygon.options[prop]) {
                polygon.setStyle(polygonOptions);
                break;
            }
        }
    }
}

/**
 * Returns true if this object was destroyed; otherwise, false.
 *
 * @returns {Boolean} True if this object was destroyed; otherwise, false.
 */
LeafletGeomVisualizer.prototype.isDestroyed = function() {
    return false;
};

/**
 * Removes and destroys all primitives created by this instance.
 */
LeafletGeomVisualizer.prototype.destroy = function() {
    var entities = this._entitiesToVisualize.values;
    for (var i = entities.length - 1; i > -1; i--) {
        entities[i]._geomLayer = undefined;
        entities[i]._geomBillboard = undefined;
        entities[i]._geomLabel = undefined;
        entities[i]._geomPoint = undefined;
    }
    this._entityCollection.collectionChanged.removeEventListener(LeafletGeomVisualizer.prototype._onCollectionChanged, this);
    this._map.removeLayer(this._featureGroup);
    return destroyObject(this);
};

/////////////////////////////////////////////////////////

var LeafletVisualizer = function() {
};

LeafletVisualizer.prototype.visualizersCallback = function(map, dataSource) {
    var entities = dataSource.entities;
    return [new LeafletGeomVisualizer(map, entities)];
};

module.exports = LeafletVisualizer;
