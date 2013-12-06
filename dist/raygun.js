/*! Raygun4js - v1.4.1 - 2013-12-04
* https://github.com/MindscapeHQ/raygun4js
* Copyright (c) 2013 MindscapeHQ; Licensed MIT */
(function traceKitAsyncForjQuery($, TraceKit) {
  'use strict';
  // quit if jQuery isn't on the page
  if (!$) {
    return;
  }

  var _oldEventAdd = $.event.add;
  $.event.add = function traceKitEventAdd(elem, types, handler, data, selector) {
    var _handler;

    if (handler.handler) {
      _handler = handler.handler;
      handler.handler = TraceKit.wrap(handler.handler);
    } else {
      _handler = handler;
      handler = TraceKit.wrap(handler);
    }

    // If the handler we are attaching doesn’t have the same guid as
    // the original, it will never be removed when someone tries to
    // unbind the original function later. Technically as a result of
    // this our guids are no longer globally unique, but whatever, that
    // never hurt anybody RIGHT?!
    if (_handler.guid) {
      handler.guid = _handler.guid;
    } else {
      handler.guid = _handler.guid = $.guid++;
    }

    return _oldEventAdd.call(this, elem, types, handler, data, selector);
  };

  var _oldReady = $.fn.ready;
  $.fn.ready = function traceKitjQueryReadyWrapper(fn) {
    return _oldReady.call(this, TraceKit.wrap(fn));
  };

  var _oldAjax = $.ajax;
  $.ajax = function traceKitAjaxWrapper(url, options) {
    if (typeof url === "object") {
      options = url;
      url = undefined;
    }

    options = options || {};

    var keys = ['complete', 'error', 'success'], key;
    while(key = keys.pop()) {
      if ($.isFunction(options[key])) {
        options[key] = TraceKit.wrap(options[key]);
      }
    }

    try {
      return _oldAjax.call(this, url, options);
    } catch (e) {
      TraceKit.report(e);
      throw e;
    }
  };

}(window.jQuery, window.TraceKit));

(function (window, $) {
  // pull local copy of TraceKit to handle stack trace collection
  var _traceKit = TraceKit.noConflict(),
      _raygun = window.Raygun,
      _raygunApiKey,
      _debugMode = false,
      _customData = {},
      _user,
      _version,
      $document;

  if ($) {
    $document = $(document);
  }

  var Raygun =
  {
    noConflict: function () {
      window.Raygun = _raygun;
      return Raygun;
    },

    init: function(key, options, customdata) {
      _raygunApiKey = key;
      _traceKit.remoteFetching = false;
      _customData = customdata;

      if (options)
      {
        if (options.debugMode)
        {
          _debugMode = options.debugMode;
        }
      }

      return Raygun;
    },

    withCustomData: function (customdata) {
      _customData = customdata;
      return Raygun;
    },

    attach: function () {
      if (!isApiKeyConfigured()) {
        return;
      }
      _traceKit.report.subscribe(processUnhandledException);
      if ($document) {
        $document.ajaxError(processJQueryAjaxError);
      }
      return Raygun;
    },

    detach: function () {
      _traceKit.report.unsubscribe(processUnhandledException);
      if ($document) {
        $document.unbind('ajaxError', processJQueryAjaxError);
      }
      return Raygun;
    },

    send: function (ex, customData) {
      try {
        processUnhandledException(_traceKit.computeStackTrace(ex), merge(_customData, customData));
      }
      catch (traceKitException) {
        if (ex !== traceKitException) {
          throw traceKitException;
        }
      }
      return Raygun;
    },

    setUser: function (user) {
      _user = { 'Identifier': user };
      return Raygun;
    },

    setVersion: function (version) {
      _version = version;
      return Raygun;
    }
  };

  /* internals */

  function processJQueryAjaxError(event, jqXHR, ajaxSettings, thrownError) {
    Raygun.send(thrownError || event.type, {
      status: jqXHR.status,
      statusText: jqXHR.statusText,
      type: ajaxSettings.type,
      url: ajaxSettings.url,
      contentType: ajaxSettings.contentType });
  }

  function log(message) {
    if (window.console && window.console.log && _debugMode) {
      window.console.log(message);
    }
  }

  function isApiKeyConfigured() {
    if (_raygunApiKey && _raygunApiKey !== '') {
      return true;
    }
    log("Raygun API key has not been configured, make sure you call Raygun.init(yourApiKey)");
    return false;
  }

  function merge(o1, o2) {
    var a, o3 = {};
    for (a in o1) { o3[a] = o1[a]; }
    for (a in o2) { o3[a] = o2[a]; }
    return o3;
  }

  function forEach(set, func) {
    for (var i = 0; i < set.length; i++) {
      func.call(null, i, set[i]);
    }
  }

  function isEmpty(o) {
    for (var p in o) {
      if (o.hasOwnProperty(p)) {
        return false;
      }
    }
    return true;
  }

  function getViewPort() {
    var e = document.documentElement,
    g = document.getElementsByTagName('body')[0],
    x = window.innerWidth || e.clientWidth || g.clientWidth,
    y = window.innerHeight || e.clientHeight || g.clientHeight;
    return { width: x, height: y };
  }

  function processUnhandledException(stackTrace, options) {
    var stack = [],
        qs = {};

    if (stackTrace.stack && stackTrace.stack.length) {
      forEach(stackTrace.stack, function (i, frame) {
        stack.push({
          'LineNumber': frame.line,
          'ClassName': 'line ' + frame.line + ', column ' + frame.column,
          'FileName': frame.url,
          'MethodName': frame.func || '[anonymous]'
        });
      });
    }

    if (window.location.search && window.location.search.length > 1) {
      forEach(window.location.search.substring(1).split('&'), function (i, segment) {
        var parts = segment.split('=');
        if (parts && parts.length === 2) {
          qs[decodeURIComponent(parts[0])] = parts[1];
        }
      });
    }

    if (isEmpty(options)) {
      options = _customData;
    }

    var screen = window.screen || { width: getViewPort().width, height: getViewPort().height, colorDepth: 8 };

    var payload = {
      'OccurredOn': new Date(),
      'Details': {
        'Error': {
          'ClassName': stackTrace.name,
          'Message': stackTrace.message || options.status + ' ' + options.url  || 'Script error',
          'StackTrace': stack
        },
        'Environment': {
          'UtcOffset': new Date().getTimezoneOffset() / -60.0,
          'User-Language': navigator.userLanguage,
          'Document-Mode': document.documentMode,
          'Browser-Width': getViewPort().width,
          'Browser-Height': getViewPort().height,
          'Screen-Width': screen.width,
          'Screen-Height': screen.height,
          'Color-Depth': screen.colorDepth,
          'Browser': navigator.appCodeName,
          'Browser-Name': navigator.appName,
          'Browser-Version': navigator.appVersion,
          'Platform': navigator.platform
        },
        'Client': {
          'Name': 'raygun-js',
          'Version': '1.4.1'
        },
        'UserCustomData': options,
        'Request': {
          'Url': document.location.href,
          'QueryString': qs,
          'Headers': {
            'User-Agent': navigator.userAgent,
            'Referer': document.referrer,
            'Host': document.domain
          }
        },
        'Version': _version || 'Not supplied'
      }
    };

    if (_user) {
      payload.Details.User = _user;
    }
    sendToRaygun(payload);
  }

  function sendToRaygun(data) {
    if (!isApiKeyConfigured()) {
      return;
    }
    log('Sending exception data to Raygun:', data);
    var url = 'https://api.raygun.io/entries?apikey=' + encodeURIComponent(_raygunApiKey);
    makeCorsRequest(url, JSON.stringify(data));
  }

  // Create the XHR object.
  function createCORSRequest(method, url) {
    var xhr;

    xhr = new window.XMLHttpRequest();
    if ("withCredentials" in xhr) {
      // XHR for Chrome/Firefox/Opera/Safari.
      xhr.open(method, url, true);
    } else if (window.XDomainRequest) {
      // XDomainRequest for IE.
      xhr = new window.XDomainRequest();
      xhr.open(method, url);
    }

    xhr.onload = function () {
      log('logged error to Raygun');
    };
    xhr.onerror = function () {
      log('failed to log error to Raygun');
    };

    return xhr;
  }

  // Make the actual CORS request.
  function makeCorsRequest(url, data) {
    var xhr = createCORSRequest('POST', url);
    if (!xhr) {
      log('CORS not supported');
      return;
    }

    xhr.send(data);
  }

  window.Raygun = Raygun;
})(window, window.jQuery);
