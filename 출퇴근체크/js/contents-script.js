var BASE_URL = 'https://spectra.daouoffice.com';

var checkInterval = 5 * 1000;
var calendarCheckInterval = 60 * 60 * 1000; // 1시간 마다

var calendarData = {};
var sessionUserName;
var sessionUserId;

var syncStorage = {};
var userConfig = {}; // 로그인 사용자 정보
var holidayList = {}; // 휴일정보
var dayOffList = {}; // 연차

(function() {

	init();


	function init() {
		// 사용여부 체크
		chrome.storage.sync.get('use-flag', function (items) {

			//alert(JSON.stringify(items));
			var useFlag = items['use-flag'];

			if (useFlag == 'Y') {
				check();
			} else {
				log('출퇴근 체크가 사용하지 않음으로 설정되어 있습니다.');
			}
		});
	}

	function check() {
		var promises =
			[
				getUserConfig(),
				requestUserSession(),
				requestCalendar()
			];

		$.when.apply($, promises).then(function () {
			// 달력정보 1시간마다 가져온다.
			setInterval(function () {
				requestCalendar();
			}, calendarCheckInterval);

			// 출퇴근시간 체크 (1분마다 체크)
			setInterval(function () {
				checkStartWorkTime();
				// 퇴근 시간 여부 체크
			}, checkInterval);
		});
	}

	function saveSyncStorage(id)
	{
		chrome.storage.sync.get(id, function(items) {
			syncStorage[id] = items[id];
			log(id + '>' + syncStorage[id])
		});
	}

	function getUserConfig() {
		// userConfig.startWorkTime = '08:00';
		// userConfig.endWorkTime = '17:00';
/*
		chrome.storage.sync.get('clock-in-hour', function(items) {
			syncStorage['clock-in-hour'] = items['clock-in-hour'];
		});

		chrome.storage.sync.get('clock-in-minute', function(items) {
			syncStorage['clock-in-minute'] = items['clock-in-minute'];
		});

		chrome.storage.sync.get('clock-out-hour', function(items) {
			syncStorage['clock-out-minute'] = items['clock-out-minute'];
		});

		chrome.storage.sync.get('clock-out-minute', function(items) {
			syncStorage['clock-out-minute'] = items['clock-out-minute'];
		});

		chrome.storage.sync.get('clock-in-before-minute', function(items) {
			syncStorage['clock-in-before-minute'] = items['clock-in-before-minute'];
		});

		chrome.storage.sync.get('clock-out-after-minute', function(items) {
			syncStorage['clock-out-after-minute'] = items['clock-out-after-minute'];
		});
*/
		var promises =
			[
				saveSyncStorage('clock-in-hour'),
				saveSyncStorage('clock-in-minute')
			];

		$.when.apply($, promises).then(function (result1, result2, result3, result4) {
			userConfig['startWorkTime'] = syncStorage['clock-in-hour'] + ':' + syncStorage['clock-in-minute']; // 출근시간
			alert(userConfig['startWorkTime']);
		});

		//
		/*
		userConfig['startWorkTime'] = syncStorage['clock-in-hour'] + ':' + syncStorage['clock-in-minute']; // 출근시간

		userConfig['endWorkTime'] = syncStorage['clock-out-hour'] + ':' + syncStorage['clock-out-minute']; // 퇴근시간
		userConfig['minuteBeforeClockIn'] = syncStorage['clock-in-before-minute']; // 출근하기 설정 시간 (출근시간 기준 몇분 이전)
		userConfig['minuteAfterClockOut'] = syncStorage['clock-out-after-minute']; // 퇴근하기 설정 시간 (퇴근시간 기준 몇분 이후)

		console.log(userConfig)
*/
	};

	function requestUserSession() {
		requestAjax('get', BASE_URL + '/api/user/session', null, function (res) {
			sessionUserId = res.data.id;
			sessionUserName = res.data.name;

			//sessionUserName = '신미란';

			log('name : ' + sessionUserName);
			log('id : ' + sessionUserId);
		});
	}

	function checkStartWorkTime() {
		// 이미 출근도장 찍었는지 여부 체크
		if (isMarkedClockInAlready()) {
			return;
		}

		// 주말인지 여부 체크
		if (isWeekend())
			return;

		// 공휴일인지 여부 체크
		if (isHoliday())
			return;

		// 연차 여부 체크
		if (isUserDayOff())
			return;

		// 출근체크 시간범위안에 들어왔는지 여부 체크
		if (isInRangeClockIn()) {
			clockIn();
		}

		// 퇴근체크 시간범위안에 들어왔는지 여부 체크
		if (isInRangeClockOut()) {
			clockOut();
		}

		// 개인연차여부 체크/반차 포함

		// 출근시간 여부 체크

		/*console.log('is start work time?');
        var params = '{"id":' + sessionUserId + ',"timeZone":"Asia/Seoul","locale":"ko","noti":"enable","useAbbroadIpCheck":"false","style":"basic","theme":"THEME_CLASSIC"}';
        requestAjax('put', BASE_URL + '/api/user/config/' + sessionUserId, params, function(res) {
            //log(res);
        });*/
	}

	function requestCalendar() {
		var currDate = new Date();
		var year = currDate.getFullYear();
		var month = currDate.getMonth() + 1;
		if (month < 10)
			month = '0' + month;
		var day = currDate.getDate();
		if (day < 10)
			day = '0' + day;

		var url = BASE_URL + '/api/calendar/user/me/event/daily?year=' + year + '&month=' + month;

		var currDate = new Date();
		requestAjax('get', url, null, function (res) {
			//console.error(JSON.stringify(res));
			calendarData = res;

			var list = res.data.list;
			for (var i = 0; i < list.length; i++) {
				var datetime = list[i].datetime;
				var eventList = list[i].eventList;

				var date = datetime.substring(0, 10);

				//log('datetime: ' + datetime)
				//log('datetime2: ' + year + '-' + month + '-' + day);

				if (eventList.length > 0) {
					for (var j = 0; j < eventList.length; j++) {
						// holiday: 휴일
						// company: 연차/공가
						var type = eventList[j].type;

						// 연차 : 서형태,박경규,한경만
						// 반차 : 이승엽(오후) 유민(오전) or ,로 구분
						// 반차 : 한경만, 박은규(오후)
						// 공가 : 유민(오후)
						var summary = eventList[j].summary;

						if (type == 'holiday') {
							holidayList[date] = type;
						} else if (type == 'company') {
							if (!dayOffList[date])
								dayOffList[date] = [];

							dayOffList[date].push(summary);
						}

					}
				}
			}
		})
	}

	// 이미 출
	function isMarkedClockInAlready() {
		log('# 출근도장 표시되었는지 체크')
		var storageClockInDate = getStorage('CLOCK_IN_DATE');

		if (storageClockInDate == getCurrDate()) {
			log('이미 출근도장이 찍혀져 있습니다.')
			return true;
		} else {
			return false;
		}
	}

	function isWeekend() {
		log('# 주말여부 체크')
		var currDate = new Date();
		//currDate = '2019-03-02';
		//currDate = currDate.addDays(2)
		if (currDate.getDay() == 0 || currDate.getDay() == 6) // 토, 일 제외
		{
			log('[' + getCurrDate() + '] 오늘은 주말입니다.');
			return true;
		} else {
			// log('today[' + getCurrDate() + '] is weekday: ');
			return false;
		}
	}

	function isHoliday() {
		log('# 공휴일 여부 체크')
		var currDate = getCurrDate();
		//currDate = '2019-03-01';

		//console.log(holidayList);
		if (holidayList[currDate]) {
			log('[' + getCurrDate() + '] 오늘은 공휴일입니다.');
			return true;
		} else {
			//log('today[' + currDate + '] is not a holiday: ');
			return false;
		}
	}

	function isUserDayOff() {
		log('# 연차 여부 체크')
		//log('이름 : ' + sessionUserName);
		//sessionUserName = '신미란';
		//console.log(dayOffList);
		var currDate = getCurrDate();
		var todayDayOffList = dayOffList[currDate];

		console.log('sessionUserName : ' + sessionUserName);

		for (var i = 0; i < todayDayOffList.length; i++) {
			var item = todayDayOffList[i];
			if (item.indexOf(sessionUserName) > -1) {
				if (!(item.indexOf('오전') > -1 || item.indexOf('오후') > -1 || item.indexOf('반차') > -1)) {
					// 연차
					log('[' + getCurrDate() + '] 오늘은 연차입니다.');
					return true;
				}
			}
		}

		return false;
	}

	function isUserDayHalfOff() {
		log('# 반차 여부 체크')
		//log('이름 : ' + sessionUserName);
		var currDate = getCurrDate();
		//currDate = '2019-03-15';
		//sessionUserName = '서정현'
		var todayDayOffList = dayOffList[currDate];
		//console.log(todayDayOffList);

		for (var i = 0; i < todayDayOffList.length; i++) {
			var item = todayDayOffList[i];
			if (item.indexOf(sessionUserName) > -1) {
				if (item.indexOf('오전') > -1) {
					return '오전';
				} else if (item.indexOf('오후') > -1) {
					return '오후';
				} else if (item.indexOf('반차') > -1) {
					log('today[' + currDate + '] is a day half off [unknown] ');
					return '오전';
				}
			}
		}

		return false;
	}

	// 출근시간 전 5분전 부터 출근시간 후 1시간 까지
	function isInRangeClockIn() {
		log('# 출근도장 범위내 여부 체크')

		// 출근시간 설정값
		var arStartWorkTime = userConfig['startWorkTime'].split(':');
		var startWorkTimeHour = arStartWorkTime[0];
		var startWorkTimeMinute = arStartWorkTime[1];

		// 이전시간 설정값
		var minuteBeforeClockIn = userConfig['minuteBeforeClockIn'];

		var date = new Date();

		// 임시코드
		//var date = new Date(2019, 3, 22, 10, 57, 0);

		var startWorkTimeDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), startWorkTimeHour, startWorkTimeMinute, 0);
		// 출근도장 찍을 시간
		var clockInMarkingTime = null;

		// 반차일 경우 시간 조정
		var userDayHalfOff = isUserDayHalfOff();
		if (userDayHalfOff == '오전') {
			clockInMarkingTime = startWorkTimeDate.addMinutes(5 * 60 - minuteBeforeClockIn); // 기준시간 12:55
		} else {
			clockInMarkingTime = startWorkTimeDate.addMinutes(-minuteBeforeClockIn); // 기준시간 07:55
		}

		var outTime = clockInMarkingTime.addMinutes(60); // 기준시간 09:00

		// log('date : ' + date);
		// log('clockInMarkingTime : ' + clockInMarkingTime);

		if (date >= clockInMarkingTime) {
			if (date > outTime) {
				log('출근도장 찍을 유효시간(1시간) 초과됨');
				return false
			} else {
				return true;
			}
		} else {
			log('출근도장 찍을 시간 아님');
			return false;
		}
	}

	// 퇴근시간 후 5분후 부터 1시간 까지
	function isInRangeClockOut() {
		log('# 퇴근도장 범위내 여부 체크')

		// 출근시간 설정값
		var arEndWorkTime = userConfig['endWorkTime'].split(':');
		var endWorkTimeHour = arEndWorkTime[0];
		var endWorkTimeMinute = arEndWorkTime[1];

		// 이후시간 설정값
		var minuteAfterClockOut = userConfig['minuteAfterClockOut'];

		var date = new Date();

		// 임시코드
		//var date = new Date(2019, 3, 22, 12, 5, 0);

		var endWorkTimeDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), endWorkTimeHour, endWorkTimeMinute, 0);
		// 퇴근도장 찍을 시간
		var clockOutMarkingTime = null;

		// 반차일 경우 시간 조정
		var userDayHalfOff = isUserDayHalfOff();
		if (userDayHalfOff == '오후') {
			clockOutMarkingTime = endWorkTimeDate.addMinutes(-5 * 60 + minuteAfterClockOut); // 기준시간 13:05
		} else {
			clockOutMarkingTime = endWorkTimeDate.addMinutes(minuteAfterClockOut); // 기준시간 15:05
		}

		var outTime = clockOutMarkingTime.addMinutes(60); // 기준시간 18:00 (17:00 + 01:00)

		//  log('date : ' + date);
		//  log('clockOutMarkingTime : ' + clockOutMarkingTime);
		// log('clockOutMarkingTime : ' + clockOutMarkingTime);

		if (date >= clockOutMarkingTime) {
			if (date > outTime) {
				log('퇴근도장 찍을 유효시간(1시간) 초과됨');
				return false
			} else {
				return true;
			}
		} else {
			log('퇴근도장 찍을 시간 아님');
			return false;
		}
	}

	function clockIn() {
		var url = BASE_URL + '/api/ehr/attnd/clockin';
		var param = {'clockInTime': getCurrDate() + 'T' + getCurrTime() + '.000+09:00'};

		/*requestAjax('put', url, param, function(res) {
			if (res.code == 200)
			{
				// 출근도장 OK
				saveLocalStorage('CLOCK_IN_DATE', currDate);
				log('[' + currDate + '] 출근도장 OK.')
			}
			else
			{
				// 실패
			}
		});*/

		var currDate = getCurrDate();
		//saveLocalStorage('CLOCK_IN_DATE', currDate);
		log('[' + currDate + '] 출근도장 OK.')
	}

	function clockOut() {
		var url = BASE_URL + '/api/ehr/attnd/clockout';
		var param = {'clockOutTime': getCurrDate() + 'T' + getCurrTime() + '.000+09:00'};

		/*requestAjax('put', url, param, function(res) {
			if (res.code == 200)
			{
				// 퇴근도장 OK
				saveLocalStorage('CLOCK_OUT_DATE', currDate);
				log('[' + currDate + '] 퇴근도장 OK.')
			}
			else
			{
				// 실패
			}
		});*/

		var currDate = getCurrDate();
		//saveLocalStorage('CLOCK_OUT_DATE', currDate);
		log('[' + currDate + '] 퇴근도장 OK.')
	}

	function saveLocalStorage(key, value) {
		/*chrome.storage.local.set(value, function() {
			log('syncStorage saved : ' + JSON.stringify(value));
		});*/

		localStorage[key] = value;

		//chrome.storage.setItem(key, value);
	}

	function getStorage(key) {
		return localStorage[key];
		/*chrome.storage.local.get(['CLOCK_IN_DATE'], function(result) {
			log('syncStorage value is : ' + JSON.stringify(result));
		});*/
	}

	function getSyncStorage(id)
	{
		chrome.storage.sync.get(id, function(items) {
			return items[id];
		});
	}

    function requestAjax(method, url, params, onSuccess)
    {
    	return $.ajax({
			type: method,
			url: url,
			data: params,
			dataType: "json",
			contentType: "application/json", // request payload로 전송됨
			beforeSend: function(res) {
				console.log('[requestAjax] '+  url)	;
			},
			success: function(res){
				onSuccess(res);
			}
		});
    }

    function log(str)
	{
		console.log(">> " + str);
	}

	function getCurrDate()
	{
		var currDate = new Date();
		var year = currDate.getFullYear();
		var month = (currDate.getMonth() + 1);
		if (month < 10)
			month = '0' + month;
		var day = currDate.getDate();
		if (day < 10)
			day = '0' + day;

		return year + '-' + month + '-' + day;
	}

	function getCurrTime()
	{
		var currDate = new Date();
		var hour = currDate.getHours();
		if (hour < 10)
			hour = '0' + hour;
		var minute = currDate.getMinutes();
		if (minute < 10)
			minute = '0' + minute;
		var second = currDate.getSeconds();
		if (second < 10)
			second = '0' + second;

		return hour + ':' + minute + ':' + second;
	}

})();

Date.prototype.addDays = function(days)
{
    var dat = new Date(this.valueOf());
    dat.setDate(dat.getDate() + days);
    return dat;
}

Date.prototype.addMinutes = function(minutes)
{
	var dat = new Date(this.valueOf());
	dat.setTime(dat.getTime() + minutes * 60000);
	return dat;
}